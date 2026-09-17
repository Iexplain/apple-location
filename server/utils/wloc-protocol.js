/**
 * Apple WLOC response patcher.
 *
 * /clls/wloc does not use a binary plist.  Its response is an 8-byte header,
 * a 2-byte big-endian protobuf length, and a protobuf payload.  We preserve
 * every unknown field Apple returns and only replace coordinates/accuracy in
 * Wi-Fi and cellular location messages.
 */

function readVarint(buffer, start) {
  let value = 0n;
  let shift = 0n;
  let offset = start;

  while (offset < buffer.length && shift <= 70n) {
    const byte = buffer[offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7n;
  }
  throw new Error(`invalid protobuf varint at offset ${start}`);
}

function encodeVarint(value) {
  let remaining = BigInt(value);
  if (remaining < 0n) remaining = BigInt.asUintN(64, remaining);

  const bytes = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0n);
  return Buffer.from(bytes);
}

function parseFields(buffer) {
  const fields = [];
  let offset = 0;

  while (offset < buffer.length) {
    const start = offset;
    const tagResult = readVarint(buffer, offset);
    const tag = Number(tagResult.value);
    offset = tagResult.offset;
    const fieldNo = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (!fieldNo) throw new Error(`invalid protobuf field 0 at offset ${start}`);

    let value;
    if (wireType === 0) {
      const result = readVarint(buffer, offset);
      value = result.value;
      offset = result.offset;
    } else if (wireType === 1) {
      if (offset + 8 > buffer.length) throw new Error('truncated protobuf fixed64');
      value = buffer.subarray(offset, offset + 8);
      offset += 8;
    } else if (wireType === 2) {
      const lengthResult = readVarint(buffer, offset);
      offset = lengthResult.offset;
      const length = Number(lengthResult.value);
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > buffer.length) {
        throw new Error('invalid protobuf length-delimited field');
      }
      value = buffer.subarray(offset, offset + length);
      offset += length;
    } else if (wireType === 5) {
      if (offset + 4 > buffer.length) throw new Error('truncated protobuf fixed32');
      value = buffer.subarray(offset, offset + 4);
      offset += 4;
    } else {
      throw new Error(`unsupported protobuf wire type ${wireType}`);
    }

    fields.push({
      fieldNo,
      wireType,
      value,
      raw: buffer.subarray(start, offset),
    });
  }
  return fields;
}

function encodeField(fieldNo, wireType, value) {
  const tag = encodeVarint(BigInt(fieldNo * 8 + wireType));
  if (wireType === 0) return Buffer.concat([tag, encodeVarint(value)]);
  if (wireType === 2) {
    return Buffer.concat([tag, encodeVarint(BigInt(value.length)), Buffer.from(value)]);
  }
  throw new Error(`cannot encode protobuf wire type ${wireType}`);
}

function patchLocationMessage(buffer, location, stats) {
  const fields = parseFields(buffer);
  let hasLatitude = false;
  let hasLongitude = false;
  let changed = false;

  const parts = fields.map((field) => {
    if (field.fieldNo === 1 && field.wireType === 0) {
      hasLatitude = true;
      changed = true;
      return encodeField(1, 0, BigInt(Math.round(location.latitude * 1e8)));
    }
    if (field.fieldNo === 2 && field.wireType === 0) {
      hasLongitude = true;
      changed = true;
      return encodeField(2, 0, BigInt(Math.round(location.longitude * 1e8)));
    }
    if (field.fieldNo === 3 && field.wireType === 0) {
      changed = true;
      return encodeField(3, 0, BigInt(Math.max(1, Math.round(location.accuracy || 65))));
    }
    return field.raw;
  });

  // A nested message with fields 1/2 can be many things.  Only count and
  // return it as a location when both coordinate fields were present.
  if (!hasLatitude || !hasLongitude) return buffer;
  if (changed) stats.locations += 1;
  return Buffer.concat(parts);
}

function patchContainer(buffer, location, locationField, stats, counterName) {
  const fields = parseFields(buffer);
  let changed = false;
  const parts = fields.map((field) => {
    if (field.fieldNo !== locationField || field.wireType !== 2) return field.raw;
    const patched = patchLocationMessage(field.value, location, stats);
    if (!patched.equals(field.value)) changed = true;
    return encodeField(field.fieldNo, 2, patched);
  });
  if (changed) stats[counterName] += 1;
  return Buffer.concat(parts);
}

function patchPayload(buffer, location, stats) {
  const fields = parseFields(buffer);
  return Buffer.concat(fields.map((field) => {
    if (field.fieldNo === 2 && field.wireType === 2) {
      return encodeField(2, 2, patchContainer(field.value, location, 2, stats, 'wifi'));
    }
    // Modern responses can carry cell tower containers in fields 22 and 24;
    // their location submessage is field 5.
    if ((field.fieldNo === 22 || field.fieldNo === 24) && field.wireType === 2) {
      return encodeField(
        field.fieldNo,
        2,
        patchContainer(field.value, location, 5, stats, 'cell'),
      );
    }
    return field.raw;
  }));
}

function patchWlocFrame(body, location) {
  if (!Buffer.isBuffer(body)) body = Buffer.from(body);
  if (body.length < 10) throw new Error(`WLOC response is too short (${body.length} bytes)`);

  const payloadLength = body.readUInt16BE(8);
  if (payloadLength + 10 > body.length) {
    throw new Error(`invalid WLOC payload length ${payloadLength} for ${body.length} bytes`);
  }

  const stats = { wifi: 0, cell: 0, locations: 0 };
  const payload = body.subarray(10, 10 + payloadLength);
  const patchedPayload = patchPayload(payload, location, stats);
  if (patchedPayload.length > 0xffff) throw new Error('patched WLOC payload is too large');

  const length = Buffer.allocUnsafe(2);
  length.writeUInt16BE(patchedPayload.length);
  return {
    body: Buffer.concat([
      body.subarray(0, 8),
      length,
      patchedPayload,
      body.subarray(10 + payloadLength),
    ]),
    stats,
  };
}

module.exports = {
  patchWlocFrame,
  // Exported for focused protocol regression tests.
  _internals: { readVarint, encodeVarint, parseFields, encodeField },
};

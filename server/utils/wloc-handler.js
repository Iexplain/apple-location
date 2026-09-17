const https = require('node:https');
const zlib = require('node:zlib');
const certs = require('./certificates');
const { patchWlocFrame } = require('./wloc-protocol');

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function requestHost(req) {
  return String(req.headers.host || '').trim().toLowerCase().replace(/:\d+$/, '');
}

function copyResponseHeaders(headers) {
  const result = { ...headers };
  delete result.connection;
  delete result['content-length'];
  delete result['content-encoding'];
  delete result['transfer-encoding'];
  return result;
}

function collect(stream, limit, callback) {
  const chunks = [];
  let size = 0;
  let finished = false;

  stream.on('data', (chunk) => {
    if (finished) return;
    size += chunk.length;
    if (size > limit) {
      finished = true;
      callback(new Error(`body exceeds ${limit} bytes`));
      if (typeof stream.destroy === 'function') stream.destroy();
      return;
    }
    chunks.push(chunk);
  });
  stream.on('end', () => {
    if (finished) return;
    finished = true;
    callback(null, Buffer.concat(chunks));
  });
  stream.on('error', (error) => {
    if (finished) return;
    finished = true;
    callback(error);
  });
}

function decodeUpstreamBody(body, encoding) {
  const normalized = String(encoding || '').toLowerCase();
  if (!normalized || normalized === 'identity') return body;
  if (normalized === 'gzip') return zlib.gunzipSync(body);
  if (normalized === 'deflate') return zlib.inflateSync(body);
  if (normalized === 'br') return zlib.brotliDecompressSync(body);
  throw new Error(`unsupported upstream content encoding: ${normalized}`);
}

function createWlocHandler({ getLocation, log = console }) {
  const allowedHosts = new Set(certs.WLOC_DOMAINS);

  return function handleWloc(req, res) {
    const pathname = String(req.url || '').split('?', 1)[0];
    if (req.method !== 'POST' || pathname !== '/clls/wloc') {
      res.writeHead(404);
      res.end();
      return;
    }

    const host = requestHost(req);
    if (!allowedHosts.has(host)) {
      log.warn(`[wloc] rejected unexpected Host: ${host || '(empty)'}`);
      res.writeHead(421);
      res.end();
      return;
    }

    collect(req, MAX_REQUEST_BYTES, (requestError, requestBody) => {
      if (requestError) {
        log.error(`[wloc] request error: ${requestError.message}`);
        if (!res.headersSent) res.writeHead(413);
        res.end();
        return;
      }

      const headers = {
        ...req.headers,
        host,
        connection: 'close',
        'accept-encoding': 'identity',
        'content-length': String(requestBody.length),
      };

      const upstream = https.request({
        hostname: host,
        port: 443,
        servername: host,
        method: 'POST',
        path: req.url,
        headers,
        timeout: 15000,
      }, (upstreamRes) => {
        collect(upstreamRes, MAX_RESPONSE_BYTES, (responseError, encodedBody) => {
          if (responseError) {
            log.error(`[wloc] upstream response error: ${responseError.message}`);
            if (!res.headersSent) res.writeHead(502);
            res.end();
            return;
          }

          let responseBody;
          try {
            responseBody = decodeUpstreamBody(encodedBody, upstreamRes.headers['content-encoding']);
          } catch (error) {
            log.error(`[wloc] response decoding failed: ${error.message}`);
            res.writeHead(502);
            res.end();
            return;
          }

          const responseHeaders = copyResponseHeaders(upstreamRes.headers);
          if (upstreamRes.statusCode !== 200) {
            responseHeaders['content-length'] = String(responseBody.length);
            res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
            res.end(responseBody);
            log.warn(`[wloc] upstream ${host} returned HTTP ${upstreamRes.statusCode}`);
            return;
          }

          try {
            const location = getLocation();
            if (!location) throw new Error('target location is not configured');
            const patched = patchWlocFrame(responseBody, location);
            responseHeaders['content-length'] = String(patched.body.length);
            responseHeaders['x-virtual-location'] = 'patched';
            res.writeHead(200, responseHeaders);
            res.end(patched.body);
            log.log(
              `[wloc] → ${location.latitude},${location.longitude} `
              + `(${patched.stats.wifi} Wi-Fi, ${patched.stats.cell} cell locations)`,
            );
          } catch (error) {
            // Preserve location availability if Apple changes the protocol;
            // return the untouched upstream response and log the mismatch.
            responseHeaders['content-length'] = String(responseBody.length);
            res.writeHead(200, responseHeaders);
            res.end(responseBody);
            log.error(`[wloc] patch failed; returned upstream response: ${error.message}`);
          }
        });
      });

      upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
      upstream.on('error', (error) => {
        log.error(`[wloc] upstream request failed for ${host}: ${error.message}`);
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      upstream.end(requestBody);
    });
  };
}

module.exports = { createWlocHandler };

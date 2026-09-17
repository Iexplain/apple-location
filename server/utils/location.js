function validateLocation(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: '请求体必须为坐标对象' };
  }
  const { latitude, longitude, altitude = 0, accuracy = 65 } = body;
  if (![latitude, longitude, altitude, accuracy].every(Number.isFinite)) {
    return { error: '纬度、经度、海拔和精度必须为有限数字' };
  }
  if (latitude < -90 || latitude > 90) return { error: '纬度必须在 -90 到 90 之间' };
  if (longitude < -180 || longitude > 180) return { error: '经度必须在 -180 到 180 之间' };
  if (accuracy < 0) return { error: '精度不能为负数' };
  return { latitude, longitude, altitude, accuracy };
}

module.exports = { validateLocation };

/**
 * Spherical geometry for the random-walk range feature.
 *
 * A range is defined by two points A and B whose connecting segment is treated
 * as the diameter of a circle. Random points are drawn uniformly **by area**,
 * so every spot inside the circle is equally likely — without the sqrt() the
 * draws would bunch up around the centre.
 *
 * Distances use the haversine great-circle formula; the random draw walks a
 * real angular distance along a bearing, which stays accurate at any radius
 * (a flat lat/lng offset would drift by 1/cos(lat) away from the equator).
 */
const EARTH_RADIUS_M = 6371008.8; // IUGG mean Earth radius

/** Below this the two points are effectively the same spot. */
const MIN_RADIUS_METERS = 1;

function toRadians(degrees) { return (degrees * Math.PI) / 180; }
function toDegrees(radians) { return (radians * 180) / Math.PI; }

/** Wrap a longitude into [-180, 180). */
function normalizeLongitude(longitude) {
  const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

/** Great-circle distance between two coordinates, in meters. */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = phi2 - phi1;
  const deltaLambda = toRadians(normalizeLongitude(lng2 - lng1));
  const a = Math.sin(deltaPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Midpoint of two coordinates.
 *
 * Averages the two positions as 3D unit vectors rather than averaging the
 * lat/lng numbers, so the result stays correct across the antimeridian
 * (179° and -179° give 180°, not 0°).
 */
function midpoint(a, b) {
  const phi1 = toRadians(a.latitude);
  const phi2 = toRadians(b.latitude);
  const lambda1 = toRadians(a.longitude);
  const lambda2 = toRadians(b.longitude);

  const x = Math.cos(phi1) * Math.cos(lambda1) + Math.cos(phi2) * Math.cos(lambda2);
  const y = Math.cos(phi1) * Math.sin(lambda1) + Math.cos(phi2) * Math.sin(lambda2);
  const z = Math.sin(phi1) + Math.sin(phi2);

  return {
    latitude: toDegrees(Math.atan2(z, Math.hypot(x, y))),
    longitude: normalizeLongitude(toDegrees(Math.atan2(y, x))),
  };
}

/** Walk `angularDistance` radians from a point along a bearing. */
function destinationPoint(latitude, longitude, angularDistance, bearing) {
  const phi1 = toRadians(latitude);
  const lambda1 = toRadians(longitude);
  const sinPhi2 = Math.sin(phi1) * Math.cos(angularDistance)
    + Math.cos(phi1) * Math.sin(angularDistance) * Math.cos(bearing);
  const phi2 = Math.asin(Math.min(1, Math.max(-1, sinPhi2)));
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(phi1),
    Math.cos(angularDistance) - Math.sin(phi1) * sinPhi2,
  );
  return {
    latitude: toDegrees(phi2),
    longitude: normalizeLongitude(toDegrees(lambda2)),
  };
}

/**
 * Build the circle whose diameter is the segment AB.
 *
 * @returns {{centerLat, centerLng, radiusMeters}}
 */
function circleFromDiameter(a, b) {
  const center = midpoint(a, b);
  return {
    centerLat: center.latitude,
    centerLng: center.longitude,
    radiusMeters: haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude) / 2,
  };
}

/**
 * Uniform-by-area random point inside the circle.
 *
 * @param {{centerLat, centerLng, radiusMeters}} circle
 * @param {() => number} [random] injectable RNG, returns [0, 1)
 */
function randomPointInCircle(circle, random = Math.random) {
  // sqrt() spreads the radius uniformly over the disc's area.
  const angularDistance = (circle.radiusMeters * Math.sqrt(random())) / EARTH_RADIUS_M;
  const bearing = 2 * Math.PI * random();
  return destinationPoint(circle.centerLat, circle.centerLng, angularDistance, bearing);
}

module.exports = {
  EARTH_RADIUS_M,
  MIN_RADIUS_METERS,
  haversineMeters,
  midpoint,
  destinationPoint,
  circleFromDiameter,
  randomPointInCircle,
  normalizeLongitude,
};
/**
 * Random-walk range routes — single-user data, protected by the app middleware.
 *
 * Two endpoints (A and B) picked from the favourites define a circle: their
 * connecting segment is the diameter. Rolling the dice drops the target
 * location at a random point inside that circle.
 *
 *   GET    /api/range         → current endpoints, centre and radius
 *   POST   /api/range         → set endpoint A or B from a favourite
 *   DELETE /api/range/:slot   → clear endpoint A or B
 *   POST   /api/range/random  → roll a point inside the circle and apply it
 */
const express = require('express');
const db = require('../db');
const {
  circleFromDiameter,
  haversineMeters,
  randomPointInCircle,
  MIN_RADIUS_METERS,
} = require('../utils/geo');

const router = express.Router();

// Column triples per slot — keeps the slot name out of raw SQL interpolation.
const SLOT_COLUMNS = {
  a: { name: 'a_name', latitude: 'a_latitude', longitude: 'a_longitude' },
  b: { name: 'b_name', latitude: 'b_latitude', longitude: 'b_longitude' },
};

function readRangeRow() {
  return db.prepare('SELECT * FROM random_range WHERE id = 1').get();
}

function readSlot(row, slot) {
  const columns = SLOT_COLUMNS[slot];
  const latitude = row[columns.latitude];
  const longitude = row[columns.longitude];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { name: row[columns.name] || '', latitude, longitude };
}

/** Shape a range row for the client, including the derived circle. */
function describeRange(row) {
  const a = readSlot(row, 'a');
  const b = readSlot(row, 'b');

  if (!a || !b) {
    return { a, b, center: null, radiusMeters: null, usable: false };
  }

  const circle = circleFromDiameter(a, b);
  return {
    a,
    b,
    center: { latitude: circle.centerLat, longitude: circle.centerLng },
    radiusMeters: circle.radiusMeters,
    usable: circle.radiusMeters >= MIN_RADIUS_METERS,
  };
}

// GET /api/range
router.get('/', (req, res) => {
  res.json(describeRange(readRangeRow()));
});

// POST /api/range — { slot: 'a' | 'b', favoriteId }
router.post('/', (req, res) => {
  const { slot, favoriteId } = req.body || {};
  const columns = SLOT_COLUMNS[slot];
  if (!columns) return res.status(400).json({ error: '槽位只能是 a 或 b' });

  if (!Number.isInteger(favoriteId)) {
    return res.status(400).json({ error: '收藏 ID 必须为整数' });
  }
  const favorite = db.prepare('SELECT * FROM favorites WHERE id = ?').get(favoriteId);
  if (!favorite) return res.status(404).json({ error: '收藏不存在' });

  // Snapshot the coordinates so deleting the favourite later does not break
  // an already-configured range.
  db.prepare(`
    UPDATE random_range
    SET ${columns.name} = ?, ${columns.latitude} = ?, ${columns.longitude} = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(favorite.name, favorite.latitude, favorite.longitude);

  res.json(describeRange(readRangeRow()));
});

// DELETE /api/range/:slot
router.delete('/:slot', (req, res) => {
  const columns = SLOT_COLUMNS[req.params.slot];
  if (!columns) return res.status(400).json({ error: '槽位只能是 a 或 b' });

  db.prepare(`
    UPDATE random_range
    SET ${columns.name} = NULL, ${columns.latitude} = NULL, ${columns.longitude} = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run();

  res.json(describeRange(readRangeRow()));
});

// POST /api/range/random — roll a point inside the circle and apply it
router.post('/random', (req, res) => {
  const range = describeRange(readRangeRow());
  if (!range.a || !range.b) {
    return res.status(400).json({ error: '请先在收藏里选择点 A 和点 B' });
  }
  if (!range.usable) {
    return res.status(400).json({ error: '两个点距离太近，无法构成有效范围' });
  }

  const point = randomPointInCircle({
    centerLat: range.center.latitude,
    centerLng: range.center.longitude,
    radiusMeters: range.radiusMeters,
  });

  // Keep the altitude/accuracy the user configured — only the spot changes.
  const current = db.prepare('SELECT altitude, accuracy FROM location WHERE id = 1').get();
  const altitude = current.altitude ?? 0;
  const accuracy = current.accuracy ?? 65;

  db.prepare(`
    UPDATE location
    SET latitude = ?, longitude = ?, altitude = ?, accuracy = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(point.latitude, point.longitude, altitude, accuracy);

  res.json({
    latitude: point.latitude,
    longitude: point.longitude,
    altitude,
    accuracy,
    radiusMeters: range.radiusMeters,
    distanceFromCenterMeters: haversineMeters(
      range.center.latitude, range.center.longitude,
      point.latitude, point.longitude,
    ),
    message: '已生成圆内随机位置并应用',
  });
});

module.exports = router;
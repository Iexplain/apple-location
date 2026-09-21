/**
 * Main app logic — the browser's same-origin Basic Auth session protects API calls.
 */

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  setTimeout(() => { el.className = 'toast'; }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
  setupLocation();
  setupFavorites();
  setupRange();
  loadLocation();
  loadFavorites();
  loadRange();
});

// ── Location ──
function setupLocation() {
  document.getElementById('saveLocationBtn').addEventListener('click', async () => {
    const lat = parseFloat(document.getElementById('latitude').value);
    const lng = parseFloat(document.getElementById('longitude').value);
    const alt = parseFloat(document.getElementById('altitude').value) || 0;
    const acc = parseFloat(document.getElementById('accuracy').value) || 65;

    if (isNaN(lat) || isNaN(lng)) { toast('请输入有效的纬度和经度', 'error'); return; }

    try {
      await API.saveLocation(lat, lng, alt, acc);
      updateLocationDisplay(lat, lng);
      toast('目标位置已保存', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('latitude').addEventListener('input', updateDisplayFromInputs);
  document.getElementById('longitude').addEventListener('input', updateDisplayFromInputs);
}

async function loadLocation() {
  try {
    const loc = await API.getLocation();
    document.getElementById('latitude').value = loc.latitude;
    document.getElementById('longitude').value = loc.longitude;
    document.getElementById('altitude').value = loc.altitude || 0;
    document.getElementById('accuracy').value = loc.accuracy || 65;
    updateLocationDisplay(loc.latitude, loc.longitude);
  } catch (err) { console.error('Failed to load location:', err); }
}

function updateDisplayFromInputs() {
  const lat = document.getElementById('latitude').value;
  const lng = document.getElementById('longitude').value;
  if (lat && lng) updateLocationDisplay(parseFloat(lat), parseFloat(lng));
}

function updateLocationDisplay(lat, lng) {
  document.getElementById('displayLat').textContent = lat.toFixed(6);
  document.getElementById('displayLng').textContent = lng.toFixed(6);
}

// ── Favorites ──
// Latest server state; the range pickers read it to highlight the chosen rows.
let currentFavorites = [];
let currentRange = null;

function setupFavorites() {
  document.getElementById('addFavBtn').addEventListener('click', async () => {
    const name = document.getElementById('favName').value.trim();
    const lat = parseFloat(document.getElementById('latitude').value);
    const lng = parseFloat(document.getElementById('longitude').value);
    const alt = parseFloat(document.getElementById('altitude').value) || 0;
    const acc = parseFloat(document.getElementById('accuracy').value) || 65;

    if (!name) { toast('请输入位置名称', 'error'); return; }
    if (isNaN(lat) || isNaN(lng)) { toast('请先设置有效坐标', 'error'); return; }

    try {
      await API.addFavorite(name, lat, lng, alt, acc);
      document.getElementById('favName').value = '';
      toast('收藏成功', 'success');
      loadFavorites();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function loadFavorites() {
  try {
    const favs = await API.getFavorites();
    currentFavorites = favs;
    const list = document.getElementById('favList');
    document.getElementById('favCount').textContent = favs.length + ' Saved';

    list.innerHTML = '';
    favs.forEach(fav => {
      const item = document.createElement('div');
      item.className = 'fav-item';
      item.innerHTML = `
        <div class="fav-item-info">
          <span class="fav-item-name">${escapeHtml(fav.name)}</span>
          <span class="fav-item-coords">${fav.latitude.toFixed(6)}, ${fav.longitude.toFixed(6)}</span>
        </div>
        <div class="fav-item-actions">
          <button class="fav-apply" data-id="${fav.id}">应用</button>
          <button class="fav-pick ${rangeSlotClass(fav, 'a')}" data-slot="a" data-id="${fav.id}">A</button>
          <button class="fav-pick ${rangeSlotClass(fav, 'b')}" data-slot="b" data-id="${fav.id}">B</button>
          <button class="fav-delete" data-id="${fav.id}">删除</button>
        </div>
      `;
      list.appendChild(item);
    });

    list.querySelectorAll('.fav-apply').forEach(btn => {
      btn.addEventListener('click', () => applyFavorite(btn.dataset.id, favs));
    });
    list.querySelectorAll('.fav-pick').forEach(btn => {
      btn.addEventListener('click', () => pickRangePoint(btn.dataset.slot, btn.dataset.id));
    });
    list.querySelectorAll('.fav-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteFavorite(btn.dataset.id));
    });
  } catch (err) { console.error('Failed to load favorites:', err); }
}

async function applyFavorite(id, favs) {
  const fav = favs.find(f => f.id == id);
  if (!fav) return;

  document.getElementById('latitude').value = fav.latitude;
  document.getElementById('longitude').value = fav.longitude;
  document.getElementById('altitude').value = fav.altitude;
  document.getElementById('accuracy').value = fav.accuracy;
  updateLocationDisplay(fav.latitude, fav.longitude);

  try {
    await API.saveLocation(fav.latitude, fav.longitude, fav.altitude, fav.accuracy);
    toast('已应用: ' + fav.name, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteFavorite(id) {
  try {
    await API.deleteFavorite(id);
    toast('已删除', 'success');
    loadFavorites();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Random walk range ──
// The two endpoints are snapshotted server-side, so a favourite matches a slot
// by its coordinates rather than by id.
function matchesSlot(fav, slot) {
  const point = currentRange && currentRange[slot];
  return Boolean(point) && point.latitude === fav.latitude && point.longitude === fav.longitude;
}

function rangeSlotClass(fav, slot) {
  if (matchesSlot(fav, 'a') && slot === 'a') return 'picked-a';
  if (matchesSlot(fav, 'b') && slot === 'b') return 'picked-b';
  return '';
}

function setupRange() {
  document.getElementById('randomBtn').addEventListener('click', async () => {
    const btn = document.getElementById('randomBtn');
    btn.disabled = true;
    try {
      const loc = await API.randomizeLocation();
      document.getElementById('latitude').value = loc.latitude;
      document.getElementById('longitude').value = loc.longitude;
      document.getElementById('altitude').value = loc.altitude;
      document.getElementById('accuracy').value = loc.accuracy;
      updateLocationDisplay(loc.latitude, loc.longitude);

      setRangeMsg(`落点距圆心 ${formatDistance(loc.distanceFromCenterMeters)}`, 'success');
      toast('已随机取点并应用', 'success');
    } catch (err) {
      setRangeMsg(err.message, 'error');
      toast(err.message, 'error');
    } finally { btn.disabled = false; }
  });
}

async function loadRange() {
  try {
    currentRange = await API.getRange();
    renderRange();
  } catch (err) { console.error('Failed to load range:', err); }
}

async function pickRangePoint(slot, favoriteId) {
  const fav = currentFavorites.find(f => f.id == favoriteId);
  if (!fav) return;

  const other = slot === 'a' ? 'b' : 'a';

  try {
    if (matchesSlot(fav, slot)) {
      // Tapping the active endpoint again releases it.
      currentRange = await API.clearRangePoint(slot);
    } else {
      // One favourite cannot be both endpoints — release the other slot first.
      if (matchesSlot(fav, other)) await API.clearRangePoint(other);
      currentRange = await API.setRangePoint(slot, favoriteId);
    }
    renderRange();
    loadFavorites();
  } catch (err) { toast(err.message, 'error'); }
}

function renderRange() {
  const range = currentRange || {};
  document.getElementById('rangeA').textContent = formatEndpoint(range.a);
  document.getElementById('rangeB').textContent = formatEndpoint(range.b);

  const center = range.center;
  document.getElementById('rangeCenter').textContent = center
    ? center.latitude.toFixed(6) + ', ' + center.longitude.toFixed(6)
    : '--';

  document.getElementById('rangeRadius').textContent = Number.isFinite(range.radiusMeters)
    ? formatDistance(range.radiusMeters)
    : '--';

  // Any change to the range invalidates the previous roll's readout.
  setRangeMsg('');
}

function formatEndpoint(point) {
  if (!point) return '未选择';
  return point.name + ' · ' + point.latitude.toFixed(6) + ', ' + point.longitude.toFixed(6);
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '--';
  return meters >= 1000 ? (meters / 1000).toFixed(1) + ' km' : Math.round(meters) + ' m';
}

function setRangeMsg(text, type = '') {
  const el = document.getElementById('rangeMsg');
  el.textContent = text;
  el.className = 'msg ' + type;
}

// ── Utils ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

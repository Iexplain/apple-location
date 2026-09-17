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
  loadLocation();
  loadFavorites();
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
          <button class="fav-delete" data-id="${fav.id}">删除</button>
        </div>
      `;
      list.appendChild(item);
    });

    list.querySelectorAll('.fav-apply').forEach(btn => {
      btn.addEventListener('click', () => applyFavorite(btn.dataset.id, favs));
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

// ── Utils ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

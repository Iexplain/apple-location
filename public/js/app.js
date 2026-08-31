/**
 * Main application logic.
 * Handles auth, location, favorites, membership, and downloads.
 */

// ── Device ID ──
function getDeviceId() {
  let id = localStorage.getItem('wkt6_device_id');
  if (!id) {
    id = 'dev-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('wkt6_device_id', id);
  }
  return id;
}

// ── Toast ──
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ── State ──
let currentUser = null;

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupAuth();
  setupLocation();
  setupFavorites();
  setupMembership();

  // Check if already logged in
  if (API.token) {
    API.me()
      .then(data => {
        currentUser = data.user;
        showMain(data.user, data.membership);
      })
      .catch(() => {
        // Token expired
        API.token = '';
        localStorage.removeItem('wkt6_token');
      });
  }
});

// ── Tabs ──
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.getElementById('loginForm').style.display = target === 'login' ? 'flex' : 'none';
      document.getElementById('registerForm').style.display = target === 'register' ? 'flex' : 'none';
      document.getElementById('authError').textContent = '';
    });
  });
}

// ── Auth ──
function setupAuth() {
  // Login
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const deviceId = getDeviceId();

    try {
      const data = await API.login(username, password, deviceId);
      API.token = data.token;
      localStorage.setItem('wkt6_token', data.token);
      currentUser = data.user;
      showMain(data.user, data.membership);
      toast('登录成功', 'success');
    } catch (err) {
      document.getElementById('authError').textContent = err.message;
    }
  });

  // Register
  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const deviceId = getDeviceId();

    try {
      const data = await API.register(username, password, deviceId);
      API.token = data.token;
      localStorage.setItem('wkt6_token', data.token);
      currentUser = data.user;
      showMain(data.user, data.membership);
      toast('注册成功，已赠送 7 天试用会员', 'success');
    } catch (err) {
      document.getElementById('authError').textContent = err.message;
    }
  });

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', () => {
    API.token = '';
    localStorage.removeItem('wkt6_token');
    currentUser = null;
    document.getElementById('authSection').style.display = '';
    document.getElementById('mainContent').style.display = 'none';
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    toast('已退出');
  });
}

// ── Show main content after login ──
async function showMain(user, membership) {
  document.getElementById('authSection').style.display = 'none';
  document.getElementById('mainContent').style.display = '';

  document.getElementById('currentUsername').textContent = user.username;

  // Set download links
  document.getElementById('downloadProfile').href = API.profileUrl();
  document.getElementById('downloadCert').href = API.certificateUrl();

  // Load location
  try {
    const loc = await API.getLocation();
    document.getElementById('latitude').value = loc.latitude;
    document.getElementById('longitude').value = loc.longitude;
    document.getElementById('altitude').value = loc.altitude || 0;
    document.getElementById('accuracy').value = loc.accuracy || 65;
    updateLocationDisplay(loc.latitude, loc.longitude);
  } catch (err) {
    console.error('Failed to load location:', err);
  }

  // Load favorites
  loadFavorites();

  // Load membership
  loadMembership();
}

// ── Location ──
function setupLocation() {
  document.getElementById('saveLocationBtn').addEventListener('click', async () => {
    const lat = parseFloat(document.getElementById('latitude').value);
    const lng = parseFloat(document.getElementById('longitude').value);
    const alt = parseFloat(document.getElementById('altitude').value) || 0;
    const acc = parseFloat(document.getElementById('accuracy').value) || 65;

    if (isNaN(lat) || isNaN(lng)) {
      toast('请输入有效的纬度和经度', 'error');
      return;
    }

    try {
      await API.saveLocation(lat, lng, alt, acc);
      updateLocationDisplay(lat, lng);
      toast('目标位置已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Live update display
  document.getElementById('latitude').addEventListener('input', updateDisplayFromInputs);
  document.getElementById('longitude').addEventListener('input', updateDisplayFromInputs);
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

    if (!name) {
      toast('请输入位置名称', 'error');
      return;
    }
    if (isNaN(lat) || isNaN(lng)) {
      toast('请先设置有效坐标', 'error');
      return;
    }

    try {
      await API.addFavorite(name, lat, lng, alt, acc);
      document.getElementById('favName').value = '';
      toast('收藏成功', 'success');
      loadFavorites();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function loadFavorites() {
  try {
    const favs = await API.getFavorites();
    const list = document.getElementById('favList');
    const count = document.getElementById('favCount');
    count.textContent = favs.length + ' Saved';

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

    // Bind events
    list.querySelectorAll('.fav-apply').forEach(btn => {
      btn.addEventListener('click', () => applyFavorite(btn.dataset.id, favs));
    });
    list.querySelectorAll('.fav-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteFavorite(btn.dataset.id));
    });
  } catch (err) {
    console.error('Failed to load favorites:', err);
  }
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
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteFavorite(id) {
  try {
    await API.deleteFavorite(id);
    toast('已删除', 'success');
    loadFavorites();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Membership ──
function setupMembership() {
  document.getElementById('activateBtn').addEventListener('click', async () => {
    const code = document.getElementById('activateCode').value.trim();
    if (!code) {
      toast('请输入激活码', 'error');
      return;
    }

    try {
      const data = await API.activate(code);
      document.getElementById('activateCode').value = '';
      toast(data.message || '激活成功', 'success');
      loadMembership();
    } catch (err) {
      document.getElementById('activateMsg').textContent = err.message;
      document.getElementById('activateMsg').className = 'msg error';
    }
  });
}

async function loadMembership() {
  const el = document.getElementById('membershipStatus');

  try {
    const m = await API.getMembership();
    const expireDate = m.expireAt ? new Date(m.expireAt) : null;
    const expireStr = expireDate ? expireDate.toLocaleDateString('zh-CN') + ' ' + expireDate.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'}) : '—';

    el.innerHTML = `
      <div class="ms-row">
        <span class="ms-label">状态</span>
        <span class="ms-value ${m.isActive ? 'ms-active' : 'ms-expired'}">
          ${m.isActive ? '● 已激活' : '● 未激活'}
        </span>
      </div>
      <div class="ms-row">
        <span class="ms-label">到期时间</span>
        <span class="ms-value">${expireStr}</span>
      </div>
      <div class="ms-row">
        <span class="ms-label">绑定设备</span>
        <span class="ms-value">${m.deviceId ? '已绑定' : '未绑定'}</span>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<p class="ms-loading">读取失败: ${escapeHtml(err.message)}</p>`;
  }
}

// ── Utils ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

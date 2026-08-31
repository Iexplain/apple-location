/**
 * API client wrapper.
 * Auto-attaches JWT token, handles JSON, throws on errors.
 */
const API = {
  baseUrl: '/api',
  token: localStorage.getItem('wkt6_token') || '',

  async request(method, path, body) {
    const url = this.baseUrl + path;
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (this.token) {
      opts.headers['Authorization'] = 'Bearer ' + this.token;
    }

    if (body) {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    const contentType = res.headers.get('Content-Type') || '';

    // Non-JSON responses (file downloads)
    if (!contentType.includes('application/json')) {
      if (!res.ok) throw new Error('Request failed: ' + res.status);
      return res;
    }

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  },

  // ── Auth ──
  register(username, password, deviceId) {
    return this.request('POST', '/auth/register', { username, password, deviceId });
  },

  login(username, password, deviceId) {
    return this.request('POST', '/auth/login', { username, password, deviceId });
  },

  me() {
    return this.request('GET', '/auth/me');
  },

  bindDevice(deviceId) {
    return this.request('POST', '/auth/device/bind', { deviceId });
  },

  activate(code) {
    return this.request('POST', '/auth/activate', { code });
  },

  // ── Location ──
  getLocation() {
    return this.request('GET', '/location');
  },

  saveLocation(lat, lng, alt, acc) {
    return this.request('POST', '/location', {
      latitude: lat,
      longitude: lng,
      altitude: alt,
      accuracy: acc,
    });
  },

  // ── Favorites ──
  getFavorites() {
    return this.request('GET', '/favorites');
  },

  addFavorite(name, lat, lng, alt, acc) {
    return this.request('POST', '/favorites', {
      name,
      latitude: lat,
      longitude: lng,
      altitude: alt,
      accuracy: acc,
    });
  },

  deleteFavorite(id) {
    return this.request('DELETE', '/favorites/' + id);
  },

  // ── Membership ──
  getMembership() {
    return this.request('GET', '/membership');
  },

  bindMemberDevice(deviceId) {
    return this.request('POST', '/membership/bind-device', { deviceId });
  },

  // ── Profile / Certificate download URLs ──
  profileUrl() {
    return this.baseUrl + '/vpn/profile?token=' + encodeURIComponent(this.token);
  },

  certificateUrl() {
    return this.baseUrl + '/certificate?token=' + encodeURIComponent(this.token);
  },
};

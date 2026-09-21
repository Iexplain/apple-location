/**
 * API client — browser Basic Auth is handled by the same-origin session.
 */
const API = {
  baseUrl: '/api',

  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(this.baseUrl + path, opts);
    const ct = res.headers.get('Content-Type') || '';

    if (!ct.includes('application/json')) {
      if (!res.ok) throw new Error('Request failed: ' + res.status);
      return res;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  // ── Location ──
  getLocation() { return this.request('GET', '/location'); },
  saveLocation(lat, lng, alt, acc) {
    return this.request('POST', '/location', { latitude: lat, longitude: lng, altitude: alt, accuracy: acc });
  },

  // ── Favorites ──
  getFavorites() { return this.request('GET', '/favorites'); },
  addFavorite(name, lat, lng, alt, acc) {
    return this.request('POST', '/favorites', { name, latitude: lat, longitude: lng, altitude: alt, accuracy: acc });
  },
  deleteFavorite(id) { return this.request('DELETE', '/favorites/' + id); },

  // ── Random walk range ──
  getRange() { return this.request('GET', '/range'); },
  setRangePoint(slot, favoriteId) { return this.request('POST', '/range', { slot, favoriteId }); },
  clearRangePoint(slot) { return this.request('DELETE', '/range/' + slot); },
  randomizeLocation() { return this.request('POST', '/range/random'); },
};

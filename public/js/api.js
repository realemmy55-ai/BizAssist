// api.js — thin HTTP client
const API = {
  async _req(method, path, data) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (data !== undefined) opts.body = JSON.stringify(data);
    const res = await fetch(path, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
    return json;
  },
  get:    (path)       => API._req('GET',    path),
  post:   (path, data) => API._req('POST',   path, data),
  put:    (path, data) => API._req('PUT',    path, data),
  delete: (path)       => API._req('DELETE', path)
};

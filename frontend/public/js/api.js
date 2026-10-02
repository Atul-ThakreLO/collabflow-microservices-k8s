// ── API Client ──────────────────────────────────────────────────────────────
const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : `${window.location.protocol}//${window.location.hostname}`;

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
  }

  setTokens(accessToken, refreshToken) {
    this.token = accessToken;
    this.refreshToken = refreshToken;
    localStorage.setItem('accessToken', accessToken);
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
  }

  clearTokens() {
    this.token = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentUser');
  }

  async request(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...options.headers,
    };

    try {
      const res = await fetch(url, { ...options, headers });

      // Auto-refresh on 401
      if (res.status === 401 && this.refreshToken && !options._retried) {
        const refreshed = await this.doRefresh();
        if (refreshed) {
          return this.request(path, { ...options, _retried: true });
        } else {
          this.clearTokens();
          window.location.reload();
          return;
        }
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw { status: res.status, message: data.error || 'Request failed', data };
      return data;
    } catch (err) {
      if (err.status) throw err;
      throw { status: 0, message: 'Network error. Is the server running?' };
    }
  }

  async doRefresh() {
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      this.setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  get(path) { return this.request(path, { method: 'GET' }); }
  post(path, body) { return this.request(path, { method: 'POST', body: JSON.stringify(body) }); }
  put(path, body) { return this.request(path, { method: 'PUT', body: JSON.stringify(body) }); }
  delete(path) { return this.request(path, { method: 'DELETE' }); }

  // ── Auth ──────────────────────────────────────────────────────────────────
  async login(email, password) {
    const data = await this.post('/api/auth/login', { email, password });
    this.setTokens(data.accessToken, data.refreshToken);
    return data;
  }

  async register(email, password, role) {
    const data = await this.post('/api/auth/register', { email, password, role });
    this.setTokens(data.accessToken, data.refreshToken);
    return data;
  }

  async logout() {
    await this.post('/api/auth/logout', { refreshToken: this.refreshToken }).catch(() => {});
    this.clearTokens();
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  getMyProfile() { return this.get('/api/users/me'); }
  updateProfile(data) { return this.put('/api/users/me', data); }
  listUsers(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.get(`/api/users${q ? '?' + q : ''}`);
  }
  getTeamStats() { return this.get('/api/users/stats'); }

  // ── Projects ──────────────────────────────────────────────────────────────
  createProject(data) { return this.post('/api/tasks/projects', data); }
  getProjects(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.get(`/api/tasks/projects${q ? '?' + q : ''}`);
  }
  getProject(id) { return this.get(`/api/tasks/projects/${id}`); }
  updateProject(id, data) { return this.put(`/api/tasks/projects/${id}`, data); }

  // ── Tasks ─────────────────────────────────────────────────────────────────
  createTask(projectId, data) { return this.post(`/api/tasks/projects/${projectId}/tasks`, data); }
  getTasks(projectId, params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.get(`/api/tasks/projects/${projectId}/tasks${q ? '?' + q : ''}`);
  }
  getTask(projectId, taskId) { return this.get(`/api/tasks/projects/${projectId}/tasks/${taskId}`); }
  updateTask(projectId, taskId, data) { return this.put(`/api/tasks/projects/${projectId}/tasks/${taskId}`, data); }
  deleteTask(projectId, taskId) { return this.delete(`/api/tasks/projects/${projectId}/tasks/${taskId}`); }
  addComment(projectId, taskId, content) { return this.post(`/api/tasks/projects/${projectId}/tasks/${taskId}/comments`, { content }); }
  getMyTasks(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.get(`/api/tasks/my-tasks${q ? '?' + q : ''}`);
  }

  // ── Notifications ─────────────────────────────────────────────────────────
  getNotifications(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.get(`/api/notifications${q ? '?' + q : ''}`);
  }
  markRead(id) { return this.put(`/api/notifications/${id}/read`, {}); }
  markAllRead() { return this.put('/api/notifications/read-all', {}); }

  // ── Analytics ─────────────────────────────────────────────────────────────
  getDashboardAnalytics() { return this.get('/api/analytics/dashboard'); }
}

window.api = new ApiClient();

export class ApiError extends Error {
  constructor(status, code, message, payload = {}) {
    super(message || 'שגיאה בתקשורת מול השרת');
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export async function apiRequest(path, { method = 'GET', body } = {}) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: {},
  };

  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(path, opts);
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      data.error || 'request_failed',
      data.message || `שגיאת שרת (${res.status})`,
      data
    );
  }

  return data;
}

export const api = {
  me: () => apiRequest('/api/auth/me'),
  register: (payload) => apiRequest('/api/auth/register', { method: 'POST', body: payload }),
  login: (payload) => apiRequest('/api/auth/login', { method: 'POST', body: payload }),
  logout: () => apiRequest('/api/auth/logout', { method: 'POST' }),
  logoutAll: () => apiRequest('/api/auth/logout-all', { method: 'POST' }),
  changePassword: (current_password, new_password) =>
    apiRequest('/api/me/password', { method: 'POST', body: { current_password, new_password } }),
  requestPasswordReset: (email) =>
    apiRequest('/api/auth/password-reset/request', { method: 'POST', body: { email } }),
  sendEmailCode: () => apiRequest('/api/auth/email/send-code', { method: 'POST' }),
  verifyEmailCode: (code) =>
    apiRequest('/api/auth/email/verify-code', { method: 'POST', body: { code } }),
  updateSettings: (payload) => apiRequest('/api/me/settings', { method: 'PATCH', body: payload }),
  exportMyData: () => apiRequest('/api/me/export'),
  deleteMyAccount: (password) =>
    apiRequest('/api/me/account', { method: 'DELETE', body: { password } }),

  home: () => apiRequest('/api/home'),
  myRuns: () => apiRequest('/api/runs'),
  createGpsRun: (payload) => apiRequest('/api/runs/gps', { method: 'POST', body: payload }),
  getRun: (id) => apiRequest(`/api/runs/${encodeURIComponent(id)}`),
  toggleRunShare: (id, is_shared) =>
    apiRequest(`/api/runs/${encodeURIComponent(id)}/share`, { method: 'PATCH', body: { is_shared } }),
  updateRunNote: (id, note) =>
    apiRequest(`/api/runs/${encodeURIComponent(id)}/note`, { method: 'PATCH', body: { note } }),
  deleteRun: (id) => apiRequest(`/api/runs/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  sources: () => apiRequest('/api/sources'),
  connectGarmin: (consent_accepted) =>
    apiRequest('/api/sources/garmin/connect', {
      method: 'POST',
      body: { consent_accepted },
    }),
  connectStrava: (consent_accepted) =>
    apiRequest('/api/sources/strava/connect', {
      method: 'POST',
      body: { consent_accepted },
    }),
  syncStrava: () => apiRequest('/api/sources/strava/sync', { method: 'POST' }),
  disconnectSource: (provider, delete_source_runs) =>
    apiRequest(`/api/sources/${encodeURIComponent(provider)}/disconnect`, {
      method: 'POST',
      body: { delete_source_runs },
    }),
  deleteSourceData: (provider) =>
    apiRequest(`/api/sources/${encodeURIComponent(provider)}/data`, { method: 'DELETE' }),

  leaderboard: (category = '5k') =>
    apiRequest(`/api/leaderboard?category=${encodeURIComponent(category)}`),

  friends: () => apiRequest('/api/friends'),
  searchUsers: (q) => apiRequest(`/api/users/search?q=${encodeURIComponent(q)}`),
  sendFriendRequest: (target_user_id) =>
    apiRequest('/api/friends/requests', { method: 'POST', body: { target_user_id } }),
  respondFriendRequest: (userId, action) =>
    apiRequest(`/api/friends/requests/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: { action },
    }),
  removeFriend: (userId) =>
    apiRequest(`/api/friends/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  blockUser: (userId) =>
    apiRequest(`/api/blocks/${encodeURIComponent(userId)}`, { method: 'POST' }),
  unblockUser: (userId) =>
    apiRequest(`/api/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  userProfile: (userId) => apiRequest(`/api/users/${encodeURIComponent(userId)}`),

  notifications: () => apiRequest('/api/notifications'),
  markNotificationRead: (id) =>
    apiRequest(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  markAllNotificationsRead: () =>
    apiRequest('/api/notifications/read-all', { method: 'POST' }),

  groups: () => apiRequest('/api/groups'),
  createGroup: (payload) => apiRequest('/api/groups', { method: 'POST', body: payload }),
  previewGroup: (code) => apiRequest(`/api/groups/preview?code=${encodeURIComponent(code)}`),
  joinGroup: (join_code) => apiRequest('/api/groups/join', { method: 'POST', body: { join_code } }),
  leaveGroup: (groupId) =>
    apiRequest(`/api/groups/${encodeURIComponent(groupId)}/leave`, { method: 'POST' }),
  groupDetail: (groupId, category = '5k') =>
    apiRequest(
      `/api/groups/${encodeURIComponent(groupId)}?category=${encodeURIComponent(category)}`
    ),

  createReport: (payload) => apiRequest('/api/reports', { method: 'POST', body: payload }),
  resources: () => apiRequest('/api/resources'),
};

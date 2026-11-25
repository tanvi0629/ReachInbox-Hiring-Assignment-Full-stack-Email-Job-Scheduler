import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const apiClient = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

// Attach JWT token to every request
apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Auto-logout on 401 — but NOT for auth routes (login/callback) to avoid redirect loops
apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (
      err.response?.status === 401 &&
      typeof window !== 'undefined' &&
      !err.config?.url?.includes('/auth/')
    ) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const authAPI = {
  me: () => apiClient.get('/auth/me'),
  googleLoginUrl: () => `${API_BASE}/auth/google`,
  logout: () => {
    localStorage.removeItem('auth_token');
    window.location.href = '/login';
  },
};

export const emailsAPI = {
  schedule: (data: FormData) => apiClient.post('/emails/schedule', data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  scheduleJson: (data: Record<string, unknown>) => apiClient.post('/emails/schedule', data),
  getScheduled: (params?: Record<string, string>) => apiClient.get('/emails/scheduled', { params }),
  getSent: (params?: Record<string, string>) => apiClient.get('/emails/sent', { params }),
  getStats: () => apiClient.get('/emails/stats'),
  cancel: (id: string) => apiClient.delete(`/emails/${id}`),
};

export const slackAPI = {
  getConnectUrl: () => apiClient.get('/slack/connect'),
  disconnect: () => apiClient.delete('/slack/disconnect'),
  getStatus: () => apiClient.get('/slack/status'),
};

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setAuthToken, getAuthToken } from '../api/client.js';

const AuthContext = createContext(null);

const STORAGE_TOKEN = 'splitEasierToken';
const STORAGE_USER = 'splitEasierUser';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const applyAuth = useCallback((token, userData) => {
    setAuthToken(token);
    setUser(userData);
    try {
      if (token) localStorage.setItem(STORAGE_TOKEN, token);
      else localStorage.removeItem(STORAGE_TOKEN);
      if (userData) localStorage.setItem(STORAGE_USER, JSON.stringify(userData));
      else localStorage.removeItem(STORAGE_USER);
    } catch (_) {}
  }, []);

  const login = useCallback(
    async (email, password) => {
      const { token, user: u } = await api.post('/auth/login', { email, password });
      applyAuth(token, u);
      return u;
    },
    [applyAuth]
  );

  const register = useCallback(
    async (email, password, name) => {
      const { token, user: u } = await api.post('/auth/register', { email, password, name });
      applyAuth(token, u);
      return u;
    },
    [applyAuth]
  );

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    try {
      localStorage.removeItem(STORAGE_TOKEN);
      localStorage.removeItem(STORAGE_USER);
    } catch (_) {}
  }, []);

  useEffect(() => {
    // If Splitwise returns code/state to a frontend route, forward to backend callback.
    const searchParams = new URLSearchParams(window.location.search);
    const oauthCode = searchParams.get('code');
    const oauthState = searchParams.get('state');
    if (oauthCode && oauthState) {
      const callbackQuery = new URLSearchParams({ code: oauthCode, state: oauthState }).toString();
      window.location.replace(`/api/auth/splitwise/callback?${callbackQuery}`);
      return;
    }

    // Accept auth payload from either hash or query (resilient to route/rewrite differences).
    const hashParams = new URLSearchParams(window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '');
    const urlToken = hashParams.get('token') || searchParams.get('token');
    const urlUser = hashParams.get('user') || searchParams.get('user');
    if (urlToken && urlUser) {
      try {
        const parsedUser = JSON.parse(urlUser);
        applyAuth(urlToken, parsedUser);
        if (window.location.hash || window.location.search) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        setLoading(false);
        return;
      } catch (_) {
        // Ignore malformed callback payload and continue with stored session.
      }
    }

    const token = localStorage.getItem(STORAGE_TOKEN);
    const stored = localStorage.getItem(STORAGE_USER);
    if (token && stored) {
      try {
        const u = JSON.parse(stored);
        setAuthToken(token);
        setUser(u);
      } catch (_) {
        localStorage.removeItem(STORAGE_TOKEN);
        localStorage.removeItem(STORAGE_USER);
      }
    }
    setLoading(false);
  }, [applyAuth]);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, applyAuth, getToken: getAuthToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

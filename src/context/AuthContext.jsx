import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setAuthToken, getAuthToken } from '../api/client.js';

const AuthContext = createContext(null);

const STORAGE_TOKEN = 'splitWiserToken';
const STORAGE_USER = 'splitWiserUser';

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
  }, []);

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

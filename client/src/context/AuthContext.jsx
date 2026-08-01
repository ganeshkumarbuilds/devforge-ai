import { createContext, useContext, useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { authApi } from '../api/auth';
import { setTokens, clearTokens } from '../api/client';

const AuthContext = createContext(null);

const STORAGE_KEY = 'devforge_auth';

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.token) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const stored = useRef(readStored());

  useEffect(() => {
    if (!stored.current) {
      setInitializing(false);
      return;
    }
    setTokens(stored.current.token, stored.current.sessionToken || null);
    let cancelled = false;
    authApi
      .me()
      .then((data) => {
        if (cancelled) return;
        setUser(data.user);
      })
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem(STORAGE_KEY);
        clearTokens();
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((data) => {
    const payload = {
      token: data.token,
      sessionToken: data.sessionToken || null,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    setTokens(data.token, data.sessionToken || null);
  }, []);

  const login = useCallback(
    async (email, password) => {
      const data = await authApi.login({ email, password });
      persist(data);
      setUser(data.user);
      return data.user;
    },
    [persist]
  );

  const register = useCallback(
    async (name, email, password) => {
      const data = await authApi.register({ name, email, password });
      persist(data);
      setUser(data.user);
      return data.user;
    },
    [persist]
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch { /* ignore */ }
    localStorage.removeItem(STORAGE_KEY);
    clearTokens();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const data = await authApi.me();
    setUser(data.user);
    return data.user;
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      initializing,
      login,
      register,
      logout,
      refreshUser,
    }),
    [user, initializing, login, register, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

import { create } from 'zustand';
import api from '../services/api';

interface User {
  id: string;
  username: string;
  avatarUrl: string | null;
  isBanned?: boolean;
  bannedReason?: string | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  error: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  initialize: () => Promise<void>;
  updateUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isInitialized: false,
  error: null,
  isLoading: false,

  login: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post('/auth/login', { username, password });
      const { access_token, user } = response.data;

      localStorage.setItem('token', access_token);
      set({
        token: access_token,
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      return true;
    } catch (err: any) {
      const message =
        err.response?.data?.message || "Kirishda xatolik. Ma'lumotlaringizni tekshiring.";
      set({ isLoading: false, error: message });
      return false;
    }
  },

  register: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post('/auth/register', { username, password });
      const { access_token, user } = response.data;

      localStorage.setItem('token', access_token);
      set({
        token: access_token,
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      return true;
    } catch (err: any) {
      const message =
        err.response?.data?.message || "Ro'yxatdan o'tishda xatolik. Ma'lumotlaringizni tekshiring.";
      set({ isLoading: false, error: message });
      return false;
    }
  },

  logout: () => {
    localStorage.removeItem('token');
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      error: null,
    });
  },

  updateUser: (user) => set({ user }),

  initialize: async () => {
    if (get().isInitialized) return;

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      set({ isInitialized: true });
      return;
    }

    try {
      const response = await api.get('/auth/me');
      set({
        user: response.data,
        token,
        isAuthenticated: true,
        isInitialized: true,
      });
    } catch (err) {
      localStorage.removeItem('token');
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isInitialized: true,
      });
    }
  },
}));

import { create } from 'zustand';
import {
  apiFetch,
  AppNotification,
  connectSocket,
  disconnectSocket,
  getStoredToken,
  HealthResponse,
  ProjectSummary,
  ScanProgressEvent,
  setStoredToken,
  User,
} from '../lib/api';

export interface ToastItem {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
}

interface AppState {
  user: User | null;
  token: string | null;
  authReady: boolean;
  signedOut: boolean;
  projects: ProjectSummary[];
  activeProjectId: string | null;
  sidebarCollapsed: boolean;
  mobileMenuOpen: boolean;
  health: HealthResponse | null;
  notifications: AppNotification[];
  unreadCount: number;
  liveScan: ScanProgressEvent | null;
  scanLog: ScanProgressEvent[];
  toasts: ToastItem[];

  bootstrap: () => Promise<void>;
  setSession: (user: User, token: string) => void;
  logout: () => void;
  fetchProjects: () => Promise<void>;
  setActiveProjectId: (id: string | null) => void;
  toggleSidebar: () => void;
  setMobileMenuOpen: (open: boolean) => void;
  fetchHealth: () => Promise<void>;
  fetchNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  clearScanLog: () => void;
  pushToast: (toast: Omit<ToastItem, 'id'>) => void;
  dismissToast: (id: string) => void;
}

const SIDEBAR_KEY = 'autopatch_sidebar_collapsed';
const ACTIVE_PROJECT_KEY = 'autopatch_active_project';
const SIGNED_OUT_KEY = 'autopatch_explicit_signout';

function bindSocketListeners(token: string, set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void, get: () => AppState) {
  const socket = connectSocket(token);
  socket.off('scan:progress');
  socket.off('notification:new');

  socket.on('scan:progress', (evt: ScanProgressEvent) => {
    set((state) => ({
      liveScan: evt,
      scanLog:
        evt.stageIndex === 1
          ? [evt]
          : [...state.scanLog.filter((item) => item.scanId === evt.scanId && item.stageIndex !== evt.stageIndex), evt],
    }));
    if (evt.status === 'completed') {
      get().fetchProjects();
    }
  });

  socket.on('notification:new', (notif: AppNotification) => {
    set((state) => {
      if (state.notifications.some((n) => n.id === notif.id)) return state;
      return {
        notifications: [notif, ...state.notifications].slice(0, 60),
        unreadCount: state.unreadCount + 1,
      };
    });
    get().pushToast({
      tone:
        notif.type === 'critical_issue' || notif.type === 'tests_failed'
          ? 'error'
          : notif.type === 'patch_applied' || notif.type === 'tests_passed'
            ? 'success'
            : 'info',
      title: notif.title,
      message: notif.message,
    });
  });
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  token: getStoredToken(),
  authReady: false,
  signedOut: (() => {
    try {
      return localStorage.getItem(SIGNED_OUT_KEY) === '1';
    } catch {
      return false;
    }
  })(),
  projects: [],
  activeProjectId: (() => {
    try {
      return localStorage.getItem(ACTIVE_PROJECT_KEY);
    } catch {
      return null;
    }
  })(),
  sidebarCollapsed: (() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  })(),
  mobileMenuOpen: false,
  health: null,
  notifications: [],
  unreadCount: 0,
  liveScan: null,
  scanLog: [],
  toasts: [],

  bootstrap: async () => {
    await get().fetchHealth();
    const existingToken = getStoredToken();
    const explicitSignOut = get().signedOut;

    if (existingToken) {
      try {
        const res = await apiFetch<{ user: User }>('/api/auth/me');
        set({ user: res.user, token: existingToken, signedOut: false });
        bindSocketListeners(existingToken, set, get);
        await Promise.all([get().fetchProjects(), get().fetchNotifications()]);
        set({ authReady: true });
        return;
      } catch {
        setStoredToken(null);
      }
    }

    if (!explicitSignOut) {
      try {
        const demo = await apiFetch<{ user: User; token: string }>('/api/auth/demo-session', {
          method: 'POST',
        });
        setStoredToken(demo.token);
        set({ user: demo.user, token: demo.token, signedOut: false });
        bindSocketListeners(demo.token, set, get);
        await Promise.all([get().fetchProjects(), get().fetchNotifications()]);
        set({ authReady: true });
        return;
      } catch {
        // Fall through to auth screen if demo session unavailable
      }
    }

    set({ user: null, token: null, authReady: true });
  },

  setSession: (user, token) => {
    setStoredToken(token);
    try {
      localStorage.removeItem(SIGNED_OUT_KEY);
    } catch {
      // ignore
    }
    set({ user, token, authReady: true, signedOut: false });
    bindSocketListeners(token, set, get);
    get().fetchProjects();
    get().fetchNotifications();
  },

  logout: () => {
    disconnectSocket();
    setStoredToken(null);
    try {
      localStorage.setItem(SIGNED_OUT_KEY, '1');
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
    } catch {
      // ignore
    }
    set({
      user: null,
      token: null,
      signedOut: true,
      projects: [],
      activeProjectId: null,
      notifications: [],
      unreadCount: 0,
    });
  },

  fetchProjects: async () => {
    try {
      const data = await apiFetch<{ projects: ProjectSummary[] }>('/api/projects');
      const currentActive = get().activeProjectId;
      const validActive =
        currentActive && data.projects.some((p) => p.id === currentActive)
          ? currentActive
          : data.projects[0]?.id ?? null;
      set({ projects: data.projects, activeProjectId: validActive });
      if (validActive) {
        try {
          localStorage.setItem(ACTIVE_PROJECT_KEY, validActive);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore when unauthenticated
    }
  },

  setActiveProjectId: (id) => {
    set({ activeProjectId: id });
    try {
      if (id) localStorage.setItem(ACTIVE_PROJECT_KEY, id);
      else localStorage.removeItem(ACTIVE_PROJECT_KEY);
    } catch {
      // ignore
    }
  },

  toggleSidebar: () => {
    set((state) => {
      const next = !state.sidebarCollapsed;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return { sidebarCollapsed: next };
    });
  },

  setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),

  fetchHealth: async () => {
    try {
      const data = await apiFetch<HealthResponse>('/api/health');
      set({ health: data });
    } catch {
      set({ health: null });
    }
  },

  fetchNotifications: async () => {
    try {
      const data = await apiFetch<{ unreadCount: number; notifications: AppNotification[] }>('/api/notifications');
      set({ unreadCount: data.unreadCount, notifications: data.notifications });
    } catch {
      // ignore
    }
  },

  markNotificationRead: async (id) => {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    set((state) => {
      const updated = state.notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n));
      return {
        notifications: updated,
        unreadCount: updated.filter((n) => !n.isRead).length,
      };
    });
  },

  markAllNotificationsRead: async () => {
    await apiFetch('/api/notifications/read-all', { method: 'PATCH' });
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    }));
  },

  clearScanLog: () => set({ liveScan: null, scanLog: [] }),

  pushToast: (toast) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }].slice(-4) }));
    setTimeout(() => {
      get().dismissToast(id);
    }, 5200);
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

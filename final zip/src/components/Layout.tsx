import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Bell,
  Bot,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileAudio2,
  FolderGit2,
  Globe,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Radar,
  ScanSearch,
  Search,
  Settings,
  ShieldCheck,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { apiFetch } from '../lib/api';
import { cn, ToastContainer } from './ui/Primitives';

interface NavSection {
  title: string;
  items: Array<{ label: string; to: string; icon: React.ComponentType<{ className?: string }> }>;
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Workspace',
    items: [
      { label: 'Overview', to: '/', icon: LayoutDashboard },
      { label: 'My Projects', to: '/projects', icon: FolderGit2 },
      { label: 'Upload & Scan', to: '/scan', icon: ScanSearch },
      { label: 'Code Workbench', to: '/workbench', icon: Code2 },
    ],
  },
  {
    title: 'AI Intelligence',
    items: [
      { label: 'Ask AutoPatch', to: '/chat', icon: Bot },
      { label: 'Bug Intelligence', to: '/intelligence', icon: BrainCircuit },
      { label: 'Code Impact Radar', to: '/impact', icon: Radar },
      { label: 'Website Debugger', to: '/website-debugger', icon: Globe },
      { label: 'Multimedia Debugger', to: '/multimedia-debugger', icon: FileAudio2 },
    ],
  },
  {
    title: 'Quality & Management',
    items: [
      { label: 'Regression Guardian', to: '/regression', icon: ShieldCheck },
      { label: 'Patch Audit Trail', to: '/audit', icon: History },
      { label: 'Notifications', to: '/notifications', icon: Bell },
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
];

interface GlobalSearchResult {
  projects: Array<{ id: string; name: string; primary_language: string }>;
  files: Array<{ id: string; project_id: string; path: string; project_name: string }>;
  bugs: Array<{ id: string; project_id: string; file_path: string; title: string; severity: string; project_name: string }>;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const {
    user,
    projects,
    activeProjectId,
    setActiveProjectId,
    sidebarCollapsed,
    toggleSidebar,
    mobileMenuOpen,
    setMobileMenuOpen,
    health,
    notifications,
    unreadCount,
    markNotificationRead,
    markAllNotificationsRead,
    logout,
  } = useAppStore();

  const navigate = useNavigate();
  const location = useLocation();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GlobalSearchResult | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileMenuOpen(false);
    setNotifOpen(false);
    setProfileOpen(false);
  }, [location.pathname, setMobileMenuOpen]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch<GlobalSearchResult>(`/api/search?q=${encodeURIComponent(trimmed)}`);
        setSearchResults(res);
        setSearchOpen(true);
      } catch {
        setSearchResults(null);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const overallStatus = health?.status === 'operational' ? 'Nominal' : health ? 'Degraded' : 'Offline';
  const statusColor =
    health?.status === 'operational' ? 'text-[#39FF88]' : health ? 'text-[#FFB020]' : 'text-[#FF3864]';

  const renderSidebarNav = (collapsed: boolean) => (
    <div className="flex h-full flex-col">
      {/* Brand header */}
      <div className="flex h-16 items-center justify-between border-b border-[#00F5FF]/15 px-4">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex min-w-0 items-center gap-2.5 text-left focus-visible:outline-none"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#00F5FF]/40 bg-[#00F5FF]/10 text-[#00F5FF]">
            <ShieldCheck className="h-4 w-4" />
          </div>
          {!collapsed && (
            <span className="font-display truncate text-base font-bold tracking-tight text-[#F1F5F9]">
              AutoPatch AI
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden rounded-md p-1.5 text-[#94A3B8] transition-colors hover:bg-[#142238] hover:text-[#00F5FF] lg:inline-flex"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close navigation menu"
          className="rounded-md p-1.5 text-[#94A3B8] hover:text-[#F1F5F9] lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation groups */}
      <nav aria-label="Main navigation" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <div className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-[#94A3B8]/80">
                {section.title}
              </div>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isNotifications = item.to === '/notifications';
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors whitespace-nowrap',
                          isActive
                            ? 'bg-[#142238] text-[#00F5FF] ring-1 ring-inset ring-[#00F5FF]/25'
                            : 'text-[#94A3B8] hover:bg-[#101A2B] hover:text-[#F1F5F9]',
                          collapsed && 'justify-center px-2'
                        )
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {isNotifications && unreadCount > 0 && (
                        <span
                          className={cn(
                            'font-mono text-[11px] font-semibold tabular-nums text-[#00F5FF]',
                            collapsed ? 'absolute right-1.5 top-1 text-[10px]' : 'ml-auto'
                          )}
                        >
                          {unreadCount}
                        </span>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom user summary */}
      {!collapsed && user && (
        <div className="border-t border-[#00F5FF]/15 p-3">
          <div className="flex items-center justify-between gap-2 rounded-md bg-[#101A2B] px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-[#F1F5F9]">{user.name}</div>
              <div className="truncate font-mono text-[11px] text-[#94A3B8]">{user.role}</div>
            </div>
            <button
              type="button"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
              className="rounded p-1.5 text-[#94A3B8] transition-colors hover:bg-[#142238] hover:text-[#FF3864]"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#070B14] text-[#F1F5F9]">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden shrink-0 border-r border-[#00F5FF]/15 bg-[#0B1220] transition-[width] duration-200 lg:block',
          sidebarCollapsed ? 'w-[70px]' : 'w-[252px]'
        )}
      >
        <div className="sticky top-0 h-screen">{renderSidebarNav(sidebarCollapsed)}</div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-64 border-r border-[#00F5FF]/20 bg-[#0B1220]">
            {renderSidebarNav(false)}
          </aside>
        </div>
      )}

      {/* Main Content Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Navigation Bar */}
        <header className="cyber-glass sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b px-4 lg:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#00F5FF]/20 bg-[#101A2B] text-[#F1F5F9] lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Global Search */}
            <div ref={searchRef} className="relative hidden max-w-md flex-1 sm:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchResults && setSearchOpen(true)}
                placeholder="Search projects, files, bugs..."
                aria-label="Global search"
                className="w-full rounded-md border border-[#00F5FF]/15 bg-[#101A2B] py-2 pl-9 pr-3 text-sm text-[#F1F5F9] placeholder-[#94A3B8] focus:border-[#00F5FF]/50 focus:outline-none"
              />
              {searchOpen && searchResults && (
                <div className="cyber-panel-elevated absolute left-0 right-0 top-full z-40 mt-2 max-h-96 overflow-y-auto rounded-lg p-3 shadow-2xl">
                  {searchResults.projects.length === 0 &&
                  searchResults.files.length === 0 &&
                  searchResults.bugs.length === 0 ? (
                    <div className="py-4 text-center text-xs text-[#94A3B8]">No matches found for "{searchQuery}".</div>
                  ) : (
                    <div className="space-y-3 text-xs">
                      {searchResults.projects.length > 0 && (
                        <div>
                          <div className="mb-1 font-semibold text-[#94A3B8]">Projects</div>
                          {searchResults.projects.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setActiveProjectId(p.id);
                                setSearchOpen(false);
                                navigate('/workbench');
                              }}
                              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-[#101A2B]"
                            >
                              <span className="font-medium text-[#F1F5F9]">{p.name}</span>
                              <span className="font-mono text-[#94A3B8]">{p.primary_language}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {searchResults.bugs.length > 0 && (
                        <div>
                          <div className="mb-1 font-semibold text-[#94A3B8]">Detected Bugs</div>
                          {searchResults.bugs.map((b) => (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => {
                                setActiveProjectId(b.project_id);
                                setSearchOpen(false);
                                navigate('/workbench');
                              }}
                              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-[#101A2B]"
                            >
                              <span className="truncate text-[#F1F5F9]">{b.title}</span>
                              <span className="shrink-0 font-mono text-[#00F5FF]">{b.file_path}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {searchResults.files.length > 0 && (
                        <div>
                          <div className="mb-1 font-semibold text-[#94A3B8]">Source Files</div>
                          {searchResults.files.map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => {
                                setActiveProjectId(f.project_id);
                                setSearchOpen(false);
                                navigate('/workbench');
                              }}
                              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-[#101A2B]"
                            >
                              <span className="truncate font-mono text-[#F1F5F9]">{f.path}</span>
                              <span className="shrink-0 text-[#94A3B8]">{f.project_name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Active Project Selector */}
            <div className="flex min-w-0 items-center gap-2">
              <label htmlFor="active-project-select" className="sr-only">
                Current project
              </label>
              <select
                id="active-project-select"
                value={activeProjectId || ''}
                onChange={(e) => setActiveProjectId(e.target.value || null)}
                className="max-w-[180px] truncate rounded-md border border-[#00F5FF]/20 bg-[#101A2B] px-3 py-2 text-xs font-medium text-[#F1F5F9] focus:border-[#00F5FF]/60 focus:outline-none sm:max-w-[230px] sm:text-sm"
              >
                {projects.length === 0 && <option value="">No projects yet</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {/* Live System Status (backed by /api/health) */}
            <button
              type="button"
              onClick={() => navigate('/settings')}
              title={health?.services.aiService.detail || 'System health'}
              className="hidden items-center gap-1.5 rounded-md border border-[#00F5FF]/15 bg-[#101A2B] px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-[#00F5FF]/35 md:inline-flex whitespace-nowrap shrink-0"
            >
              <Activity className={cn('h-3.5 w-3.5', statusColor)} />
              <span className="text-[#94A3B8]">System:</span>
              <span className={cn('font-mono font-semibold', statusColor)}>{overallStatus}</span>
            </button>

            {/* Notification Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((o) => !o);
                  setProfileOpen(false);
                }}
                aria-label={`Notifications (${unreadCount} unread)`}
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#00F5FF]/15 bg-[#101A2B] text-[#F1F5F9] transition-colors hover:border-[#00F5FF]/40 hover:text-[#00F5FF]"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#FF3864] px-1 font-mono text-[10px] font-bold text-white tabular-nums">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="cyber-panel-elevated absolute right-0 top-full z-40 mt-2 w-80 rounded-lg p-3 shadow-2xl sm:w-96">
                  <div className="flex items-center justify-between border-b border-[#00F5FF]/15 pb-2">
                    <span className="text-sm font-semibold text-[#F1F5F9]">Notifications</span>
                    <div className="flex items-center gap-3">
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={() => markAllNotificationsRead()}
                          className="text-xs text-[#00F5FF] hover:underline"
                        >
                          Mark all read
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setNotifOpen(false);
                          navigate('/notifications');
                        }}
                        className="text-xs text-[#94A3B8] hover:text-[#F1F5F9]"
                      >
                        View all
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 max-h-80 space-y-1.5 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="py-6 text-center text-xs text-[#94A3B8]">No notifications recorded yet.</div>
                    ) : (
                      notifications.slice(0, 6).map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            if (!n.isRead) markNotificationRead(n.id);
                            if (n.projectId) setActiveProjectId(n.projectId);
                            setNotifOpen(false);
                            navigate(n.linkPath || '/');
                          }}
                          className={cn(
                            'block w-full rounded-md p-2.5 text-left transition-colors hover:bg-[#101A2B]',
                            !n.isRead && 'bg-[#00F5FF]/[0.06]'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-[#F1F5F9]">{n.title}</span>
                            {!n.isRead && <span className="font-mono text-[10px] text-[#00F5FF]">New</span>}
                          </div>
                          <p className="mt-0.5 text-xs text-[#94A3B8] line-clamp-2">{n.message}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Settings quick button */}
            <button
              type="button"
              onClick={() => navigate('/settings')}
              aria-label="Open Settings"
              className="hidden h-10 w-10 items-center justify-center rounded-md border border-[#00F5FF]/15 bg-[#101A2B] text-[#94A3B8] transition-colors hover:border-[#00F5FF]/40 hover:text-[#00F5FF] sm:inline-flex"
            >
              <Settings className="h-4 w-4" />
            </button>

            {/* User Profile Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setProfileOpen((o) => !o);
                  setNotifOpen(false);
                }}
                aria-label="User profile menu"
                className="flex h-10 items-center gap-2 rounded-md border border-[#00F5FF]/15 bg-[#101A2B] px-2.5 text-sm text-[#F1F5F9] transition-colors hover:border-[#00F5FF]/40"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded bg-[#A855F7]/20 text-[#A855F7]">
                  <UserIcon className="h-3.5 w-3.5" />
                </div>
                <span className="hidden max-w-[110px] truncate text-xs font-medium xl:inline">
                  {user?.name || 'Engineer'}
                </span>
              </button>
              {profileOpen && user && (
                <div className="cyber-panel-elevated absolute right-0 top-full z-40 mt-2 w-60 rounded-lg p-3 shadow-2xl">
                  <div className="border-b border-[#00F5FF]/15 pb-2.5">
                    <div className="text-sm font-semibold text-[#F1F5F9]">{user.name}</div>
                    <div className="truncate font-mono text-xs text-[#94A3B8]">{user.email}</div>
                  </div>
                  <div className="mt-2 space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        navigate('/settings');
                      }}
                      className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-[#F1F5F9] hover:bg-[#101A2B]"
                    >
                      <Settings className="h-3.5 w-3.5 text-[#94A3B8]" />
                      Workspace Settings
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        logout();
                      }}
                      className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-[#FF3864] hover:bg-[#101A2B]"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Sign Out / Switch Account
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Workspace Canvas */}
        <main className="cyber-grid-bg flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>

      <ToastContainer />
    </div>
  );
}

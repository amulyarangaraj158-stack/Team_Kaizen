import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  FolderGit2,
  BookOpenText,
  ScanSearch,
  Radar,
  GitCompare,
  FlaskConical,
  RotateCcw,
  BrainCircuit,
  GraduationCap,
  FileBarChart2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Bell,
  LogOut,
  User as UserIcon,
  X,
  Menu,
  CheckCheck,
  Loader2,
  Bot,
  Languages,
  Globe,
  FileImage,
  History,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatTimestamp } from '../lib/format';
import type { NotificationItem, ProjectSummary, User, WorkspaceModule } from '../types';

export interface NavItemDef {
  id: WorkspaceModule;
  label: string;
  group: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const NAV_GROUPS: Array<{ title: string; items: NavItemDef[] }> = [
  {
    title: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', group: 'Overview', icon: LayoutDashboard },
      { id: 'projects', label: 'Projects & Upload', group: 'Overview', icon: FolderGit2 },
    ],
  },
  {
    title: 'Analyze & Understand',
    items: [
      { id: 'explain', label: 'Code & Explain', group: 'Analyze & Understand', icon: BookOpenText },
      { id: 'scanner', label: 'Scanner & RCA', group: 'Analyze & Understand', icon: ScanSearch },
      { id: 'radar', label: 'Impact Radar', group: 'Analyze & Understand', icon: Radar },
      { id: 'chat', label: 'Ask AutoPatch', group: 'Analyze & Understand', icon: Bot },
      { id: 'languages', label: 'Multi-Language', group: 'Analyze & Understand', icon: Languages },
    ],
  },
  {
    title: 'Web & Media Debug',
    items: [
      { id: 'website', label: 'Website Debugger', group: 'Web & Media Debug', icon: Globe },
      { id: 'multimedia', label: 'Multimedia Debugger', group: 'Web & Media Debug', icon: FileImage },
    ],
  },
  {
    title: 'Repair & Guard',
    items: [
      { id: 'repair', label: 'Repair & Diff', group: 'Repair & Guard', icon: GitCompare },
      { id: 'testing', label: 'Test Guardian', group: 'Repair & Guard', icon: FlaskConical },
      { id: 'rollback', label: 'Patch Rollback', group: 'Repair & Guard', icon: RotateCcw },
      { id: 'audit', label: 'Patch Audit Trail', group: 'Repair & Guard', icon: History },
    ],
  },
  {
    title: 'Intelligence & History',
    items: [
      { id: 'patterns', label: 'Pattern Intelligence', group: 'Intelligence & History', icon: BrainCircuit },
      { id: 'learning', label: 'Learn & Growth', group: 'Intelligence & History', icon: GraduationCap },
      { id: 'reports', label: 'History & Reports', group: 'Intelligence & History', icon: FileBarChart2 },
    ],
  },
];

const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

interface WorkspaceShellProps {
  user: User;
  activeModule: WorkspaceModule;
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  notifications: NotificationItem[];
  onSelectModule: (mod: WorkspaceModule) => void;
  onSelectProject: (projectId: string) => void;
  onRefreshNotifications: () => Promise<void>;
  onUserUpdated: (user: User) => void;
  onLogout: () => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, desc?: string) => void;
  notifOpenTrigger?: number;
  children: React.ReactNode;
}

export function WorkspaceShell({
  user,
  activeModule,
  projects,
  selectedProjectId,
  notifications,
  onSelectModule,
  onSelectProject,
  onRefreshNotifications,
  onUserUpdated,
  onLogout,
  onNotify,
  notifOpenTrigger = 0,
  children,
}: WorkspaceShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    if (notifOpenTrigger > 0) {
      setNotifOpen(true);
    }
  }, [notifOpenTrigger]);

  // Profile form state
  const [profileName, setProfileName] = useState(user.name);
  const [profileRole, setProfileRole] = useState(user.role);
  const [profileBio, setProfileBio] = useState(user.bio || '');
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    setProfileName(user.name);
    setProfileRole(user.role);
    setProfileBio(user.bio || '');
  }, [user]);

  // Global Ctrl+K / Cmd+K Command Palette Shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
        setNotifOpen(false);
        setProfileOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const activeNav = ALL_NAV_ITEMS.find((i) => i.id === activeModule);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  const paletteResults = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    const modules = ALL_NAV_ITEMS.filter(
      (item) => !q || item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q)
    );
    const matchingProjects = projects.filter(
      (p) => !q || p.name.toLowerCase().includes(q) || p.primary_language.toLowerCase().includes(q)
    );
    return { modules, matchingProjects };
  }, [paletteQuery, projects]);

  const handleMarkAllRead = async () => {
    await apiRequest('/api/notifications/read-all', { method: 'POST' });
    await onRefreshNotifications();
  };

  const handleClearNotifications = async () => {
    await apiRequest('/api/notifications', { method: 'DELETE' });
    await onRefreshNotifications();
  };

  const handleNotificationClick = async (n: NotificationItem) => {
    if (!n.is_read) {
      try {
        await apiRequest(`/api/notifications/${n.id}/read`, { method: 'PATCH' });
        await onRefreshNotifications();
      } catch {
        // ignore
      }
    }
    if (n.project_id && projects.some((p) => p.id === n.project_id)) {
      onSelectProject(n.project_id);
    }
    const validModules = new Set<string>(ALL_NAV_ITEMS.map((item) => item.id));
    if (n.action_module && validModules.has(n.action_module)) {
      onSelectModule(n.action_module as WorkspaceModule);
    }
    setNotifOpen(false);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const data = await apiRequest<{ user: User }>('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ name: profileName, role: profileRole, bio: profileBio }),
      });
      onUserUpdated(data.user);
      setProfileOpen(false);
      onNotify('success', 'Profile Updated', 'Your developer account settings were saved.');
    } catch (err: unknown) {
      onNotify('error', 'Update failed', err instanceof Error ? err.message : 'Unable to save profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex flex-col h-full">
      {/* Brand Row */}
      <div className="h-16 px-4 border-b border-[#151F38] flex items-center justify-between gap-2 shrink-0">
        {(!sidebarCollapsed || isMobile) && (
          <button
            type="button"
            onClick={() => onSelectModule('dashboard')}
            className="flex items-center gap-2.5 text-left min-w-0"
          >
            <span className="w-7 h-7 rounded-md bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-xs font-mono font-bold text-white shrink-0">
              AP
            </span>
            <span className="text-base font-bold text-white font-display tracking-tight truncate">
              AutoPatch AI
            </span>
          </button>
        )}
        {!isMobile ? (
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-[#131E36] rounded-lg transition-colors mx-auto"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="p-1.5 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-4 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            {(!sidebarCollapsed || isMobile) && (
              <p className="px-2.5 mb-1.5 text-[11px] font-medium text-slate-500 tracking-wide">
                {group.title}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={sidebarCollapsed && !isMobile ? item.label : undefined}
                    onClick={() => {
                      onSelectModule(item.id);
                      if (isMobile) setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-blue-600/20 text-blue-200 border border-blue-500/25'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-[#111B33] border border-transparent'
                    } ${sidebarCollapsed && !isMobile ? 'justify-center' : ''}`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-400' : 'text-slate-500'}`} />
                    {(!sidebarCollapsed || isMobile) && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom User Strip */}
      <div className="p-3 border-t border-[#151F38] shrink-0">
        <div className={`flex items-center gap-2.5 ${sidebarCollapsed && !isMobile ? 'justify-center' : 'justify-between'}`}>
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="flex items-center gap-2.5 min-w-0 hover:opacity-90 text-left"
          >
            <div className="w-8 h-8 rounded-lg bg-[#162342] border border-[#243763] flex items-center justify-center text-xs font-semibold text-blue-300 shrink-0">
              {user.name
                .split(' ')
                .map((s) => s[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </div>
            {(!sidebarCollapsed || isMobile) && (
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-200 truncate">{user.name}</p>
                <p className="text-[11px] text-slate-500 truncate">{user.role}</p>
              </div>
            )}
          </button>
          {(!sidebarCollapsed || isMobile) && (
            <button
              type="button"
              onClick={onLogout}
              className="p-1.5 text-slate-500 hover:text-red-400 transition-colors shrink-0"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100 flex">
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-[#090F1E] border-r border-[#151F38] shrink-0 transition-[width] duration-200 sticky top-0 h-screen ${
          sidebarCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/65" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative w-64 max-w-[80vw] bg-[#090F1E] border-r border-[#151F38] h-full z-10">
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-16 bg-[#070B14]/92 backdrop-blur-md border-b border-[#151F38] px-4 lg:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-slate-400 hover:text-white"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0 truncate">
              <span className="hidden sm:inline text-slate-500">{activeNav?.group}</span>
              <span className="hidden sm:inline text-slate-600">/</span>
              <span className="text-slate-100 font-medium truncate">{activeNav?.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Global Project Selector */}
            <select
              aria-label="Active project selector"
              value={selectedProjectId || ''}
              onChange={(e) => onSelectProject(e.target.value)}
              className="max-w-[180px] sm:max-w-[230px] px-3 py-1.5 text-xs bg-[#0C1324] border border-[#1E2B4A] rounded-lg text-slate-200 focus:outline-none focus:border-blue-500 truncate"
            >
              {projects.length === 0 ? (
                <option value="">No projects uploaded</option>
              ) : (
                projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              )}
            </select>

            {/* Global Search / Command Palette Trigger */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-[#0C1324] border border-[#1E2B4A] rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Search workspace...</span>
              <kbd className="hidden sm:inline font-mono text-[10px] text-slate-500">Ctrl K</kbd>
            </button>

            {/* Notifications */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                className="relative p-2 text-slate-400 hover:text-white bg-[#0C1324] border border-[#1E2B4A] rounded-lg transition-colors"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-[10px] font-mono text-white flex items-center justify-center tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-[420px] bg-[#0C1324] border border-[#1E2B4A] rounded-xl shadow-2xl overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-[#162038] flex items-center justify-between gap-2 bg-[#090F1E]">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">Notification Center</span>
                      {unreadCount > 0 && (
                        <span className="text-[10px] font-mono text-cyan-400 tabular-nums">
                          {unreadCount} unread
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={handleMarkAllRead}
                          className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                        >
                          <CheckCheck className="w-3.5 h-3.5" />
                          Mark all read
                        </button>
                      )}
                      {notifications.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearNotifications}
                          className="text-[11px] text-slate-400 hover:text-red-400 flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="max-h-96 overflow-y-auto divide-y divide-[#141E34]">
                    {notifications.length === 0 ? (
                      <p className="p-6 text-xs text-slate-500 text-center">No notifications yet.</p>
                    ) : (
                      notifications.map((n) => {
                        const typeTone =
                          n.type === 'success'
                            ? { icon: CheckCircle2, color: 'text-emerald-400', border: 'border-l-emerald-500' }
                            : n.type === 'warning'
                              ? { icon: AlertTriangle, color: 'text-amber-400', border: 'border-l-amber-500' }
                              : n.type === 'error'
                                ? { icon: AlertCircle, color: 'text-red-400', border: 'border-l-red-500' }
                                : { icon: Info, color: 'text-cyan-400', border: 'border-l-cyan-500' };
                        const TypeIcon = typeTone.icon;
                        return (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => void handleNotificationClick(n)}
                            className={`w-full text-left px-4 py-3 text-xs border-l-2 ${typeTone.border} hover:bg-[#131F3A] transition-colors ${
                              n.is_read ? 'opacity-70' : 'bg-cyan-500/[0.04]'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-2 min-w-0">
                                <TypeIcon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${typeTone.color}`} />
                                <p className="font-medium text-slate-100 leading-snug">{n.title}</p>
                              </div>
                              <span className="text-[10px] font-mono text-slate-500 shrink-0 tabular-nums">
                                {formatTimestamp(n.created_at)}
                              </span>
                            </div>
                            <p className="text-slate-400 mt-1 pl-5 leading-relaxed">{n.message}</p>
                            {(n.project_name || n.action_module) && (
                              <div className="mt-1.5 pl-5 flex items-center justify-between text-[10px] font-mono text-slate-500">
                                <span className="truncate">{n.project_name || 'Workspace'}</span>
                                {n.action_module && <span className="text-cyan-400">Open →</span>}
                              </div>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Profile Button */}
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="p-2 text-slate-400 hover:text-white bg-[#0C1324] border border-[#1E2B4A] rounded-lg transition-colors"
              title="Profile Settings"
            >
              <UserIcon className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Workflow Progress Bar (subtle contextual guidance when project is selected) */}
        {selectedProject && activeModule !== 'dashboard' && (
          <div className="px-4 lg:px-6 py-2 bg-[#090F1E] border-b border-[#141E34] flex items-center justify-between gap-4 text-[11px] overflow-x-auto">
            <div className="flex items-center gap-3 whitespace-nowrap text-slate-400">
              <span className="font-mono text-slate-300 font-medium">{selectedProject.name}</span>
              <span className="text-slate-600">·</span>
              {(
                [
                  { mod: 'projects', label: '1. Upload' },
                  { mod: 'scanner', label: '2. Scan' },
                  { mod: 'explain', label: '3. Explain' },
                  { mod: 'repair', label: '4. Repair' },
                  { mod: 'testing', label: '5. Test' },
                ] as const
              ).map((step) => (
                <button
                  key={step.mod}
                  type="button"
                  onClick={() => onSelectModule(step.mod)}
                  className={`transition-colors ${
                    activeModule === step.mod ? 'text-blue-400 font-semibold' : 'hover:text-slate-200'
                  }`}
                >
                  {step.label}
                </button>
              ))}
            </div>
            <span className="font-mono text-slate-500 whitespace-nowrap tabular-nums">
              {selectedProject.total_files} files · {selectedProject.total_lines} lines
            </span>
          </div>
        )}

        {/* Active Module Viewport */}
        <main className="flex-1 p-4 lg:p-6 max-w-[1480px] w-full mx-auto">{children}</main>
      </div>

      {/* Command Palette Modal (Ctrl+K) */}
      {paletteOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-20 p-4"
          onClick={() => setPaletteOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-[#0C1324] border border-[#1E2B4A] rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-[#162038] flex items-center gap-2.5">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                autoFocus
                type="text"
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                placeholder="Jump to module or switch project..."
                className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
              />
              <button type="button" onClick={() => setPaletteOpen(false)} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto p-2 space-y-3">
              {paletteResults.modules.length > 0 && (
                <div>
                  <p className="px-2.5 py-1 text-[11px] font-mono text-slate-500">Workspace Modules</p>
                  {paletteResults.modules.map((m) => {
                    const Icon = m.icon;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onSelectModule(m.id);
                          setPaletteOpen(false);
                          setPaletteQuery('');
                        }}
                        className="w-full px-3 py-2 rounded-lg text-xs text-slate-200 hover:bg-[#15203A] flex items-center justify-between transition-colors"
                      >
                        <span className="flex items-center gap-2.5">
                          <Icon className="w-3.5 h-3.5 text-blue-400" />
                          {m.label}
                        </span>
                        <span className="text-[11px] text-slate-500">{m.group}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {paletteResults.matchingProjects.length > 0 && (
                <div>
                  <p className="px-2.5 py-1 text-[11px] font-mono text-slate-500">Switch Active Project</p>
                  {paletteResults.matchingProjects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onSelectProject(p.id);
                        setPaletteOpen(false);
                        setPaletteQuery('');
                      }}
                      className="w-full px-3 py-2 rounded-lg text-xs text-slate-200 hover:bg-[#15203A] flex items-center justify-between transition-colors"
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="text-[11px] font-mono text-slate-500">{p.primary_language}</span>
                    </button>
                  ))}
                </div>
              )}

              {paletteResults.modules.length === 0 && paletteResults.matchingProjects.length === 0 && (
                <p className="p-6 text-xs text-slate-500 text-center">No matching modules or projects.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Profile Settings Modal */}
      {profileOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setProfileOpen(false)}
        >
          <form
            onSubmit={handleSaveProfile}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-[#0C1324] border border-[#1E2B4A] rounded-xl p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white font-display">Profile Settings</h2>
              <button type="button" onClick={() => setProfileOpen(false)} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Email</label>
              <input
                type="email"
                disabled
                value={user.email}
                className="w-full px-3 py-2 text-sm bg-[#080D19] border border-[#162038] rounded-lg text-slate-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#080D19] border border-[#1E2B4A] rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">Role</label>
              <input
                type="text"
                value={profileRole}
                onChange={(e) => setProfileRole(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#080D19] border border-[#1E2B4A] rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">Engineering Focus / Bio</label>
              <textarea
                rows={3}
                value={profileBio}
                onChange={(e) => setProfileBio(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#080D19] border border-[#1E2B4A] rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={onLogout}
                className="px-3 py-2 text-xs text-red-400 hover:text-red-300 flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setProfileOpen(false)}
                  className="px-3.5 py-2 text-xs text-slate-300 bg-[#151F38] hover:bg-[#1E2B4A] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg flex items-center gap-1.5"
                >
                  {savingProfile && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

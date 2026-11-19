import React, { useState, useEffect, useCallback } from 'react';
import { apiRequest, setStoredToken } from './lib/api';
import type {
  ChatCodeSnippet,
  DetectedBug,
  NotificationItem,
  ProjectSummary,
  UploadedFile,
  User,
  WorkspaceModule,
} from './types';
import { LandingPage } from './components/LandingPage';
import { AuthView } from './components/AuthView';
import { WorkspaceShell } from './components/WorkspaceShell';
import {
  ConfirmDialog,
  LoadingPanel,
  ToastContainer,
  type ConfirmDialogState,
  type ToastMessage,
} from './components/ui/ToastAndConfirm';
import { DashboardModule } from './components/modules/DashboardModule';
import { ProjectsModule } from './components/modules/ProjectsModule';
import { CodeExplainModule } from './components/modules/CodeExplainModule';
import { ScannerRcaModule } from './components/modules/ScannerRcaModule';
import { ImpactRadarModule } from './components/modules/ImpactRadarModule';
import { RepairDiffModule } from './components/modules/RepairDiffModule';
import { TestGuardianModule } from './components/modules/TestGuardianModule';
import { PatchRollbackModule } from './components/modules/PatchRollbackModule';
import { PatternIntelligenceModule } from './components/modules/PatternIntelligenceModule';
import { LearningInsightsModule } from './components/modules/LearningInsightsModule';
import { HistoryReportsModule } from './components/modules/HistoryReportsModule';
import { AskAutoPatchModule } from './components/modules/AskAutoPatchModule';
import { MultiLanguageModule } from './components/modules/MultiLanguageModule';
import { WebsiteDebuggerModule } from './components/modules/WebsiteDebuggerModule';
import { MultimediaDebuggerModule } from './components/modules/MultimediaDebuggerModule';
import { PatchAuditTrailModule } from './components/modules/PatchAuditTrailModule';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [publicScreen, setPublicScreen] = useState<'landing' | 'auth'>('landing');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  const [activeModule, setActiveModule] = useState<WorkspaceModule>('dashboard');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<UploadedFile[]>([]);
  const [projectBugs, setProjectBugs] = useState<DetectedBug[]>([]);
  const [selectedBugId, setSelectedBugId] = useState<string | null>(null);
  const [jumpTarget, setJumpTarget] = useState<{ fileId: string; line: number } | null>(null);
  const [pendingChatSnippet, setPendingChatSnippet] = useState<ChatCodeSnippet | null>(null);
  const [notifOpenTrigger, setNotifOpenTrigger] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const notify = useCallback(
    (type: ToastMessage['type'], title: string, description?: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, type, title, description }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4800);
    },
    []
  );

  const openConfirm = useCallback(
    (opts: {
      title: string;
      message: string;
      confirmLabel: string;
      destructive?: boolean;
      onConfirm: () => Promise<void>;
    }) => {
      setConfirmDialog({
        open: true,
        ...opts,
        onConfirm: async () => {
          setConfirmBusy(true);
          try {
            await opts.onConfirm();
          } finally {
            setConfirmBusy(false);
          }
        },
      });
    },
    []
  );

  // Restore session on boot
  useEffect(() => {
    apiRequest<{ user: User }>('/api/auth/me')
      .then((res) => {
        setUser(res.user);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setAuthChecked(true);
      });
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiRequest<{ notifications: NotificationItem[] }>('/api/notifications');
      setNotifications(res.notifications);
    } catch {
      // ignore
    }
  }, [user]);

  const loadProjects = useCallback(
    async (preferProjectId?: string) => {
      if (!user) return;
      try {
        const res = await apiRequest<{ projects: ProjectSummary[] }>('/api/projects');
        setProjects(res.projects);
        setSelectedProjectId((current) => {
          if (preferProjectId && res.projects.some((p) => p.id === preferProjectId)) {
            return preferProjectId;
          }
          if (current && res.projects.some((p) => p.id === current)) {
            return current;
          }
          return res.projects[0]?.id || null;
        });
      } catch {
        // ignore
      }
    },
    [user]
  );

  const loadSelectedProjectDetails = useCallback(async () => {
    if (!user || !selectedProjectId) {
      setProjectFiles([]);
      setProjectBugs([]);
      return;
    }
    try {
      const [detailRes, bugsRes] = await Promise.all([
        apiRequest<{ project: ProjectSummary; files: UploadedFile[] }>(`/api/projects/${selectedProjectId}`),
        apiRequest<{ bugs: DetectedBug[] }>(`/api/projects/${selectedProjectId}/bugs`),
      ]);
      setProjectFiles(detailRes.files);
      setProjectBugs(bugsRes.bugs);
    } catch {
      setProjectFiles([]);
      setProjectBugs([]);
    }
  }, [user, selectedProjectId]);

  const refreshAllWorkspaceData = useCallback(async () => {
    await Promise.all([loadProjects(), loadSelectedProjectDetails(), loadNotifications()]);
    setRefreshTrigger((n) => n + 1);
  }, [loadProjects, loadSelectedProjectDetails, loadNotifications]);

  useEffect(() => {
    if (user) {
      void loadProjects();
      void loadNotifications();
    }
  }, [user, loadProjects, loadNotifications]);

  useEffect(() => {
    void loadSelectedProjectDetails();
  }, [loadSelectedProjectDetails]);

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setStoredToken(null);
    setUser(null);
    setProjects([]);
    setSelectedProjectId(null);
    setProjectFiles([]);
    setProjectBugs([]);
    setActiveModule('dashboard');
    setPublicScreen('landing');
    notify('info', 'Signed out', 'Your session has been closed.');
  };

  const handleJumpToCode = (fileId: string, line: number) => {
    setJumpTarget({ fileId, line });
    setActiveModule('explain');
  };

  const handleSelectBugForRepair = (bugId: string) => {
    setSelectedBugId(bugId);
    setActiveModule('repair');
  };

  const handleAskAboutCode = (snippet: ChatCodeSnippet) => {
    setPendingChatSnippet(snippet);
    setActiveModule('chat');
  };

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#070B14] flex items-center justify-center">
        <LoadingPanel message="Initializing AutoPatch AI workspace..." />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        {publicScreen === 'landing' ? (
          <LandingPage
            onGetStarted={(mode = 'login') => {
              setAuthMode(mode);
              setPublicScreen('auth');
            }}
          />
        ) : (
          <AuthView
            initialMode={authMode}
            onBack={() => setPublicScreen('landing')}
            onAuthenticated={(u) => {
              setUser(u);
              setActiveModule('dashboard');
              notify('success', `Welcome back, ${u.name}`, 'Workspace session authenticated.');
            }}
          />
        )}
        <ToastContainer
          toasts={toasts}
          onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
        />
      </>
    );
  }

  return (
    <>
      <WorkspaceShell
        user={user}
        activeModule={activeModule}
        projects={projects}
        selectedProjectId={selectedProjectId}
        notifications={notifications}
        onSelectModule={setActiveModule}
        onSelectProject={(pid) => {
          setSelectedProjectId(pid);
          setSelectedBugId(null);
        }}
        onRefreshNotifications={loadNotifications}
        onUserUpdated={setUser}
        onLogout={handleLogout}
        onNotify={notify}
        notifOpenTrigger={notifOpenTrigger}
      >
        {activeModule === 'dashboard' && (
          <DashboardModule
            selectedProjectId={selectedProjectId}
            onSelectProject={(pid) => {
              setSelectedProjectId(pid);
              notify('info', 'Active project switched', 'All workspace modules now focus on the selected project.');
            }}
            onNavigate={setActiveModule}
            onOpenNotifications={() => setNotifOpenTrigger((n) => n + 1)}
            refreshTrigger={refreshTrigger}
          />
        )}

        {activeModule === 'projects' && (
          <ProjectsModule
            projects={projects}
            selectedProjectId={selectedProjectId}
            projectFiles={projectFiles}
            onSelectProject={(pid) => setSelectedProjectId(pid)}
            onRefreshProjects={async (selectId) => {
              await loadProjects(selectId);
              await loadNotifications();
              setRefreshTrigger((n) => n + 1);
            }}
            onNavigate={setActiveModule}
            onNotify={notify}
            onConfirm={openConfirm}
          />
        )}

        {activeModule === 'explain' && (
          <CodeExplainModule
            project={selectedProject}
            files={projectFiles}
            jumpTarget={jumpTarget}
            onClearJumpTarget={() => setJumpTarget(null)}
            onAskAboutCode={handleAskAboutCode}
            onNavigate={setActiveModule}
            onNotify={notify}
          />
        )}

        {activeModule === 'scanner' && (
          <ScannerRcaModule
            project={selectedProject}
            files={projectFiles}
            bugs={projectBugs}
            onRefreshProjectData={refreshAllWorkspaceData}
            onJumpToCode={handleJumpToCode}
            onSelectBugForRepair={handleSelectBugForRepair}
            onNavigate={setActiveModule}
            onNotify={notify}
          />
        )}

        {activeModule === 'radar' && (
          <ImpactRadarModule
            project={selectedProject}
            onJumpToCode={handleJumpToCode}
            onNavigate={setActiveModule}
            refreshTrigger={refreshTrigger}
          />
        )}

        {activeModule === 'repair' && (
          <RepairDiffModule
            project={selectedProject}
            files={projectFiles}
            bugs={projectBugs}
            selectedBugId={selectedBugId}
            onSelectBugId={setSelectedBugId}
            onRefreshProjectData={refreshAllWorkspaceData}
            onNavigate={setActiveModule}
            onNotify={notify}
            onConfirm={openConfirm}
          />
        )}

        {activeModule === 'testing' && (
          <TestGuardianModule
            project={selectedProject}
            bugs={projectBugs}
            selectedBugId={selectedBugId}
            onSelectBugId={setSelectedBugId}
            onRefreshProjectData={refreshAllWorkspaceData}
            onNavigate={setActiveModule}
            onNotify={notify}
          />
        )}

        {activeModule === 'rollback' && (
          <PatchRollbackModule
            project={selectedProject}
            files={projectFiles}
            onRefreshProjectData={refreshAllWorkspaceData}
            onNavigate={setActiveModule}
            onNotify={notify}
            onConfirm={openConfirm}
            refreshTrigger={refreshTrigger}
          />
        )}

        {activeModule === 'patterns' && (
          <PatternIntelligenceModule
            projects={projects}
            selectedProjectId={selectedProjectId}
            onNavigate={setActiveModule}
            refreshTrigger={refreshTrigger}
          />
        )}

        {activeModule === 'learning' && (
          <LearningInsightsModule
            onNavigate={setActiveModule}
            onNotify={notify}
            refreshTrigger={refreshTrigger}
          />
        )}

        {activeModule === 'reports' && (
          <HistoryReportsModule
            project={selectedProject}
            onNavigate={setActiveModule}
            onNotify={notify}
            onRefreshNotifications={loadNotifications}
            refreshTrigger={refreshTrigger}
          />
        )}

        {activeModule === 'chat' && (
          <AskAutoPatchModule
            project={selectedProject}
            files={projectFiles}
            bugs={projectBugs}
            pendingSnippet={pendingChatSnippet}
            onClearPendingSnippet={() => setPendingChatSnippet(null)}
            onJumpToCode={handleJumpToCode}
            onSelectBugForRepair={handleSelectBugForRepair}
            onNavigate={setActiveModule}
            onNotify={notify}
          />
        )}

        {activeModule === 'languages' && (
          <MultiLanguageModule
            project={selectedProject}
            onJumpToCode={handleJumpToCode}
            onNavigate={setActiveModule}
            onNotify={notify}
            onRefreshWorkspace={refreshAllWorkspaceData}
            refreshTrigger={refreshTrigger}
          />
        )}

        {activeModule === 'website' && (
          <WebsiteDebuggerModule
            onNotify={notify}
            onRefreshWorkspace={refreshAllWorkspaceData}
          />
        )}

        {activeModule === 'multimedia' && (
          <MultimediaDebuggerModule
            project={selectedProject}
            onNotify={notify}
            onRefreshWorkspace={refreshAllWorkspaceData}
          />
        )}

        {activeModule === 'audit' && (
          <PatchAuditTrailModule
            projects={projects}
            selectedProjectId={selectedProjectId}
            onNotify={notify}
            onRefreshWorkspace={refreshAllWorkspaceData}
            refreshTrigger={refreshTrigger}
          />
        )}
      </WorkspaceShell>

      <ToastContainer
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
      <ConfirmDialog
        state={confirmDialog}
        busy={confirmBusy}
        onClose={() => setConfirmDialog(null)}
      />
    </>
  );
}

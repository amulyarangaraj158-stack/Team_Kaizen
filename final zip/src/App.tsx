import React, { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useAppStore } from './store/useAppStore';
import { Layout } from './components/Layout';
import { AuthPage } from './pages/AuthPage';
import { OverviewPage } from './pages/OverviewPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { UploadScanPage } from './pages/UploadScanPage';
import { WorkbenchPage } from './pages/WorkbenchPage';
import { AskAutoPatchPage } from './pages/AskAutoPatchPage';
import { BugIntelligencePage } from './pages/BugIntelligencePage';
import { ImpactRadarPage } from './pages/ImpactRadarPage';
import { WebsiteDebuggerPage } from './pages/WebsiteDebuggerPage';
import { MultimediaDebuggerPage } from './pages/MultimediaDebuggerPage';
import { RegressionGuardianPage } from './pages/RegressionGuardianPage';
import { AuditTrailPage } from './pages/AuditTrailPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { SettingsPage } from './pages/SettingsPage';

const queryClient = new QueryClient();

function AppShell() {
  const { user, authReady, bootstrap } = useAppStore();

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  if (!authReady) {
    return (
      <div className="cyber-grid-bg flex min-h-screen flex-col items-center justify-center gap-3 text-[#F1F5F9]">
        <Loader2 className="h-7 w-7 animate-spin text-[#00F5FF]" />
        <span className="font-mono text-xs text-[#94A3B8]">Initializing AutoPatch AI Command Centre...</span>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/scan" element={<UploadScanPage />} />
        <Route path="/workbench" element={<WorkbenchPage />} />
        <Route path="/chat" element={<AskAutoPatchPage />} />
        <Route path="/intelligence" element={<BugIntelligencePage />} />
        <Route path="/impact" element={<ImpactRadarPage />} />
        <Route path="/website-debugger" element={<WebsiteDebuggerPage />} />
        <Route path="/multimedia-debugger" element={<MultimediaDebuggerPage />} />
        <Route path="/regression" element={<RegressionGuardianPage />} />
        <Route path="/audit" element={<AuditTrailPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

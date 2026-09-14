import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { listWorkspaces } from '@/api/client';
import { AppShell } from '@/components/AppShell';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { GlobalSettingsPage } from '@/pages/GlobalSettingsPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { AgentConversationPage } from '@/pages/AgentConversationPage';
import { LoginPage } from '@/pages/LoginPage';
import { InvitePage } from '@/pages/InvitePage';
import { MissionsPage } from '@/pages/MissionsPage';
import { RunsPage } from '@/pages/RunsPage';
import { SetupPage } from '@/pages/SetupPage';
import { UsersPage } from '@/pages/UsersPage';
import { AccessPage } from '@/pages/AccessPage';
import { AuditPage } from '@/pages/AuditPage';
import { ServicePrincipalsPage } from '@/pages/ServicePrincipalsPage';
import { WorkspaceHomePage } from '@/pages/WorkspaceHomePage';
import { WorkspacePage } from '@/pages/WorkspacePage';
import { WorkspaceConfigPage } from '@/pages/WorkspaceConfigPage';
import { WorkspaceConnectionsPage } from '@/pages/WorkspaceConnectionsPage';
import { WorkspacePluginsPage } from '@/pages/WorkspacePluginsPage';
import { WorkspacesPage } from '@/pages/WorkspacesPage';

const MissionDetailPage = lazy(() => import('@/pages/MissionDetailPage').then((module) => ({ default: module.MissionDetailPage })));
const MissionRunsPage = lazy(() => import('@/pages/MissionRunsPage').then((module) => ({ default: module.MissionRunsPage })));

export default function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/setup" element={<FullPageSetup />} />
        <Route path="/login" element={<FullPageLogin />} />
        <Route path="/invite" element={<InvitePage />} />
        <Route element={<AppShell context="global" />}>
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/service-principals" element={<ServicePrincipalsPage />} />
          <Route path="/access" element={<AccessPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<GlobalSettingsPage />} />
        </Route>
        <Route path="/w/:workspaceId" element={<AppShell context="workspace" />}>
          <Route index element={<WorkspaceHomePage />} />
          <Route path="missions" element={<MissionsPage />} />
          <Route path="missions/:missionName" element={<LazyPage><MissionDetailPage /></LazyPage>} />
          <Route path="missions/:missionName/runs" element={<LazyPage><MissionRunsPage /></LazyPage>} />
          <Route path="missions/:missionName/runs/:runId" element={<LazyPage><MissionRunsPage /></LazyPage>} />
          <Route path="missions/:missionName/runs/:runId/execution" element={<Navigate replace relative="path" to=".." />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/:agentName" element={<AgentConversationPage purpose="session" />} />
          <Route path="agents/:agentName/session" element={<AgentConversationPage purpose="session" />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="connections" element={<WorkspaceConnectionsPage />} />
          <Route path="config" element={<WorkspaceConfigPage />} />
          <Route path="plugins" element={<WorkspacePluginsPage />} />
          <Route path="settings" element={<WorkspacePage />} />
        </Route>
        <Route path="*" element={<Navigate replace to="/workspaces" />} />
      </Routes>
    </ThemeProvider>
  );
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="grid min-h-80 place-items-center text-sm text-muted-foreground">Loading mission…</div>}>{children}</Suspense>;
}

function FullPageSetup() {
  return (
    <>
      <div className="fixed right-4 top-4 z-50"><ThemeToggle /></div>
      <SetupPage />
    </>
  );
}

function FullPageLogin() {
  return (
    <>
      <div className="fixed right-4 top-4 z-50"><ThemeToggle /></div>
      <LoginPage />
    </>
  );
}

function RootRedirect() {
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: listWorkspaces });
  if (workspaces.isLoading) {
    return <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">Opening Command Center…</div>;
  }
  const lastWorkspaceID = window.localStorage.getItem('lastWorkspaceId');
  const lastWorkspace = workspaces.data?.find((workspace) => workspace.id === lastWorkspaceID);
  const selectedWorkspace = lastWorkspace ?? workspaces.data?.[0];
  return <Navigate replace to={selectedWorkspace ? `/w/${selectedWorkspace.id}` : '/workspaces'} />;
}

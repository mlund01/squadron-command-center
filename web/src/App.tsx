import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ThemeProvider } from './components/ThemeProvider'
import { AppLayout } from './components/AppLayout'
import { RootRedirect } from './pages/RootRedirect'
import { MissionsPage } from './pages/MissionsPage'
import { AgentsPage } from './pages/AgentsPage'
import { PluginsPage } from './pages/PluginsPage'
import { MissionDetail } from './pages/MissionDetail'
import { MissionHistory } from './pages/MissionHistory'
import { MissionInstanceDetail } from './pages/MissionInstanceDetail'
import { AgentDetail } from './pages/AgentDetail'
import { ConfigPage } from './pages/ConfigPage'
import { CostsPage } from './pages/CostsPage'
import { FileBrowserPage } from './pages/FileBrowserPage'
import { FileViewerPage } from './pages/FileViewerPage'
import { VariablesPage } from './pages/VariablesPage'
import { SkillsPage } from './pages/SkillsPage'
import { SkillDetail } from './pages/SkillDetail'

function App() {
  return (
    <ThemeProvider>
    <Toaster richColors position="bottom-right" />
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/instances/:id" element={<AppLayout />}>
        <Route index element={<Navigate to="missions" replace />} />
        <Route path="missions" element={<MissionsPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="agents/:name" element={<AgentDetail />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="skills/:name" element={<SkillDetail />} />
        <Route path="tools" element={<PluginsPage />} />
        <Route path="history" element={<MissionHistory />} />
        <Route path="missions/:name" element={<MissionDetail />} />
        <Route path="runs/:mid" element={<MissionInstanceDetail />} />
        <Route path="costs" element={<CostsPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="variables" element={<VariablesPage />} />
        <Route path="files" element={<FileBrowserPage />} />
        <Route path="files/view" element={<FileViewerPage />} />
      </Route>
    </Routes>
    </ThemeProvider>
  )
}

export default App

import { Outlet, useParams } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppSidebar } from './AppSidebar';
import { useHumanInputAlerts } from '@/hooks/use-human-input-alerts';

export function AppLayout() {
  const { id } = useParams<{ id: string }>();
  // Toast + chime on every new ask_human request that arrives while
  // the operator is anywhere except the Inbox.
  useHumanInputAlerts(id);

  return (
    <TooltipProvider>
      <SidebarProvider style={{ '--sidebar-width': '200px' } as React.CSSProperties}>
        <AppSidebar />
        <SidebarInset className="min-w-0 h-svh overflow-y-auto">
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

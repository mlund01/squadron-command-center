import { Outlet, useParams } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppSidebar } from './AppSidebar';
import { useInstanceNotifications } from '@/hooks/use-instance-notifications';

export function AppLayout() {
  const { id } = useParams<{ id: string }>();
  // Subscribe once per instance at the shell level so toasts fire regardless
  // of which page is mounted.
  useInstanceNotifications(id);
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="overflow-hidden min-w-0">
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

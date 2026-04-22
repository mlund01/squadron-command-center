import { Outlet } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppSidebar } from './AppSidebar';

export function AppLayout() {
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

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listInstances, listWorkspaces } from '@/api/client';

export function RootRedirect() {
  const navigate = useNavigate();
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
    retry: false,
  });
  const { data: instances, isLoading } = useQuery({
    queryKey: ['instances'],
    queryFn: listInstances,
    enabled: workspaces.isError,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (workspaces.isSuccess) {
      navigate('/workspaces', { replace: true });
      return;
    }
    if (!instances) return;
    const connected = instances.find((i) => i.connected);
    if (connected) {
      navigate(`/instances/${connected.id}/missions`, { replace: true });
    }
  }, [instances, navigate, workspaces.isSuccess]);

  if (workspaces.isSuccess) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading workspaces…</div>;
  }

  if (workspaces.isLoading || isLoading) {
    return <div className="flex items-center justify-center h-screen text-muted-foreground">Loading...</div>;
  }

  const hasConnected = instances?.some((i) => i.connected);
  if (hasConnected) {
    return <div className="flex items-center justify-center h-screen text-muted-foreground">Redirecting...</div>;
  }

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">Squadron Commander</h1>
        <p className="text-muted-foreground">
          No instances connected. Start a squadron instance with{' '}
          <code className="bg-muted px-1.5 py-0.5 rounded text-sm">squadron serve</code>.
        </p>
      </div>
    </div>
  );
}

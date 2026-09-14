import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { listWorkspaces } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';

export function WorkspaceSectionPage({ description, title }: { description: string; title: string }) {
  const { workspaceId } = useParams();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: listWorkspaces });
  const workspace = workspaces.data?.find((candidate) => candidate.id === workspaceId);

  return (
    <div>
      <PageHeader description={description} eyebrow={workspace?.name ?? 'Workspace'} title={title} />
      <Card>
        <CardContent className="flex min-h-52 items-center justify-center text-center text-sm text-muted-foreground">
          This workspace section is ready for its first capability.
        </CardContent>
      </Card>
    </div>
  );
}

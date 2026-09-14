import { KeyRound, ServerCog } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function GlobalSettingsPage() {
  return (
    <div>
      <PageHeader
        description="Configure authentication and deployment-wide behavior for this Command Center."
        eyebrow="Command Center"
        title="Settings"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <KeyRound className="mb-2 size-5 text-muted-foreground" />
            <CardTitle>Authentication</CardTitle>
            <CardDescription>Identity provider and local access configuration belong at the Command Center level.</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <ServerCog className="mb-2 size-5 text-muted-foreground" />
            <CardTitle>Deployment</CardTitle>
            <CardDescription>Public URL, storage, and infrastructure-level settings for this installation.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}

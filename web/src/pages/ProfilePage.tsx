import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from '@/api/client';
import { ConnectorAuthorizationsPanel } from '@/components/ConnectorAuthorizationsPanel';
import { PageHeader } from '@/components/PageHeader';

export function ProfilePage() {
  const user = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser });
  return <div className="space-y-6">
    <PageHeader eyebrow="Account" title="Profile" description="Your identity and personal connector authorizations." />
    <section className="rounded-md border bg-card p-4">
      <h2 className="text-sm font-semibold">Account</h2>
      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Name</dt><dd className="mt-1 font-medium">{user.data?.name ?? '—'}</dd></div>
        <div><dt className="text-muted-foreground">Email</dt><dd className="mt-1 font-medium">{user.data?.email ?? '—'}</dd></div>
      </dl>
    </section>
    <ConnectorAuthorizationsPanel />
  </div>;
}

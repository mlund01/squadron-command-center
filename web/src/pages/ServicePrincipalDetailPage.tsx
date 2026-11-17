import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { listServicePrincipals } from '@/api/client';
import { ConnectorAuthorizationsPanel } from '@/components/ConnectorAuthorizationsPanel';
import { PageHeader } from '@/components/PageHeader';

export function ServicePrincipalDetailPage() {
  const { principalId } = useParams();
  const principals = useQuery({ queryKey: ['service-principals'], queryFn: listServicePrincipals });
  const principal = principals.data?.find((item) => item.id === principalId);
  return <div className="space-y-6">
    <Link className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground" to="/service-principals"><ArrowLeft className="size-3.5" />Service principals</Link>
    {principals.isLoading && <p className="text-xs text-muted-foreground">Loading service principal…</p>}
    {principals.isError && <p className="text-xs text-destructive">Unable to load service principal.</p>}
    {!principals.isLoading && !principals.isError && !principal && <p className="text-xs text-muted-foreground">Service principal not found.</p>}
    {principal && <>
      <PageHeader eyebrow="Service principal" title={principal.name} description={principal.description || 'Non-human execution identity.'} />
      <section className="rounded-md border bg-card p-4 text-xs"><span className="text-muted-foreground">Status</span><span className="ml-3 font-medium capitalize">{principal.status}</span></section>
      <ConnectorAuthorizationsPanel identityName={principal.name} principalId={principal.id} />
    </>}
  </div>;
}

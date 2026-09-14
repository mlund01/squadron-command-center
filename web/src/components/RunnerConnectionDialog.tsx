import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { revealWorkerCredential } from '@/api/client';
import type { WorkerEnrollment } from '@/api/client';
import type { Workspace } from '@/api/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Connection = Pick<WorkerEnrollment, 'commandCenterURL' | 'credential'>;

export function RunnerConnectionDialog({
  freshConnection,
  onOpenChange,
  open,
  workspace,
}: {
  freshConnection?: Connection | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  workspace: Workspace | null;
}) {
  const revealedConnection = useQuery({
    queryKey: ['workspaces', workspace?.id, 'credential'],
    queryFn: () => revealWorkerCredential(workspace!.id),
    enabled: open && workspace !== null && freshConnection == null && Boolean(workspace.worker),
  });
  const connection = freshConnection ?? revealedConnection.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Runner connection</DialogTitle>
          <DialogDescription>
            Connection details for {workspace?.name}. Administrators can return here at any time.
          </DialogDescription>
        </DialogHeader>

        {revealedConnection.isLoading && freshConnection == null && (
          <p className="py-6 text-sm text-muted-foreground">Loading connection details…</p>
        )}
        {revealedConnection.isError && (
          <p className="py-6 text-sm text-destructive">Credential unavailable.</p>
        )}
        {connection && (
          <>
            <ConnectionDetails
              commandCenterURL={connection.commandCenterURL}
              credential={connection.credential}
            />
            <p className="text-sm text-muted-foreground">
              Run <code className="rounded border bg-muted px-1.5 py-0.5">squadron engage</code> in the workspace. On first start, Squadron will prompt for the URL and credential and save them locally with restricted permissions.
            </p>
          </>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

function ConnectionDetails({ commandCenterURL, credential }: Connection) {
  return (
    <dl className="grid gap-4 rounded-md border bg-muted p-4 text-sm">
      <ConnectionDetail label="Command Center WebSocket URL" value={commandCenterURL} />
      <div>
        <dt className="text-xs text-muted-foreground">Runner credential</dt>
        <dd className="mt-1"><CredentialValue credential={credential} /></dd>
      </div>
      <ConnectionDetail label="Start Squadron" value="squadron engage --foreground" />
    </dl>
  );
}

function ConnectionDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs text-foreground">{value}</code>
        <CopyButton label={label} value={value} />
      </dd>
    </div>
  );
}

function CredentialValue({ credential }: { credential: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-xs text-foreground">
        {credential.slice(0, 5)}
        <span aria-hidden="true" className="select-none">{'•'.repeat(Math.max(credential.length - 5, 0))}</span>
      </code>
      <CopyButton label="runner credential" value={credential} />
    </div>
  );
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <Button
      aria-label={`Copy ${label}`}
      onClick={copyValue}
      size="icon-xs"
      title={copied ? 'Copied' : `Copy ${label}`}
      type="button"
      variant="ghost"
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

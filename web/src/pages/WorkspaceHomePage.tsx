import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, Paperclip, Sparkles } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { listWorkspaces } from '@/api/client';
import { Button } from '@/components/ui/button';

const starters = ['Create a mission', 'Plan a change', 'Explore this workspace'];

export function WorkspaceHomePage() {
  const { workspaceId } = useParams();
  const [prompt, setPrompt] = useState('');
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: listWorkspaces });
  const workspace = workspaces.data?.find((candidate) => candidate.id === workspaceId) ?? null;

  if (workspaces.isLoading) return <p className="text-sm text-muted-foreground">Loading workspace…</p>;
  if (!workspace) return <p className="text-sm text-destructive">Workspace not found.</p>;

  return (
    <div className="flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center pb-20">
      <div className="w-full max-w-3xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-full border bg-card shadow-sm">
            <Sparkles className="size-5 text-primary" />
          </div>
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{workspace.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Let&apos;s get to work.</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            Describe a goal, ask a question, or create a mission.
          </p>
        </div>

        <form className="rounded-xl border bg-card p-3 shadow-sm dark:shadow-none" onSubmit={(event) => event.preventDefault()}>
          <textarea
            aria-label="Message workspace agent"
            autoFocus
            className="min-h-28 w-full resize-none bg-transparent px-2 py-2 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe what you want to accomplish…"
            value={prompt}
          />
          <div className="flex items-center justify-between border-t pt-3">
            <Button aria-label="Attach a file" disabled size="icon-sm" type="button" variant="ghost"><Paperclip /></Button>
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                <span className={`size-1.5 rounded-full ${workspace.worker?.status === 'connected' ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                Workspace agent
              </span>
              <Button aria-label="Send message" disabled={!prompt.trim()} size="icon-sm" title="Chat functionality coming soon" type="submit"><ArrowUp /></Button>
            </div>
          </div>
        </form>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {starters.map((starter) => (
            <Button className="rounded-full" key={starter} onClick={() => setPrompt(starter)} size="sm" type="button" variant="outline">
              {starter}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

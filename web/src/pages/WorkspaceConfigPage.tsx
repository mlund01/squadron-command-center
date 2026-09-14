import { useMemo, useState } from 'react';
import { Box, BrainCircuit, ChevronRight, Database, KeyRound, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getWorkspaceConfig, listWorkspaces } from '@/api/client';
import type { InstanceConfig, ModelInfo, SharedFolderInfo, SkillInfo, VariableInfo } from '@/api/types';
import { PageHeader } from '@/components/PageHeader';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Category = 'models' | 'skills' | 'variables' | 'memory';
type ConfigItem = ModelInfo | SkillInfo | VariableInfo | SharedFolderInfo;

const categories: Array<{ key: Category; label: string; description: string; icon: LucideIcon }> = [
  { key: 'models', label: 'Models', description: 'Configured model providers and aliases', icon: BrainCircuit },
  { key: 'skills', label: 'Skills', description: 'Reusable agent instructions and tools', icon: Sparkles },
  { key: 'variables', label: 'Variables', description: 'Runtime values and secret declarations', icon: KeyRound },
  { key: 'memory', label: 'Shared memory', description: 'Persistent workspace and mission folders', icon: Database },
];

export function WorkspaceConfigPage() {
  const { workspaceId } = useParams();
  const [active, setActive] = useState<Category>('models');
  const [selected, setSelected] = useState<{ category: Category; item: ConfigItem } | null>(null);
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: listWorkspaces });
  const workspace = workspaces.data?.find((candidate) => candidate.id === workspaceId);
  const snapshot = useQuery({
    queryKey: ['workspace-config', workspaceId],
    queryFn: () => getWorkspaceConfig(workspaceId!),
    enabled: Boolean(workspaceId),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const collections = useMemo(() => configCollections(snapshot.data?.config), [snapshot.data?.config]);
  const definition = categories.find((category) => category.key === active)!;

  return <div>
    <PageHeader eyebrow={workspace?.name ?? 'Workspace'} title="Config" description="Inspect the supporting configuration reported by this workspace’s Squadron runner." />
    {snapshot.isLoading ? <ConfigState text="Loading workspace configuration…" /> : snapshot.isError ? <ConfigState text="Connect the workspace runner to inspect its configuration." /> : <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav className="space-y-1" aria-label="Configuration categories">
        {categories.map((category) => {
          const Icon = category.icon;
          return <button key={category.key} type="button" onClick={() => setActive(category.key)} className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent', active === category.key && 'bg-accent')}>
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1"><span className="block text-xs font-medium">{category.label}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{category.description}</span></span>
            <span className="text-[10px] tabular-nums text-muted-foreground">{collections[category.key].length}</span>
          </button>;
        })}
      </nav>
      <section className="min-w-0 rounded-md border bg-card">
        <div className="border-b px-5 py-4"><h2 className="text-sm font-semibold">{definition.label}</h2><p className="mt-1 text-xs text-muted-foreground">{definition.description}</p></div>
        <div className="divide-y">
          {collections[active].map((item) => <button key={itemKey(active, item)} type="button" onClick={() => setSelected({ category: active, item })} className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-accent/50">
            <span className="grid size-8 shrink-0 place-items-center rounded border bg-muted"><Box className="size-3.5 text-muted-foreground" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{itemName(item)}</span><span className="mt-1 block truncate text-[11px] text-muted-foreground">{itemSummary(active, item)}</span></span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          </button>)}
          {collections[active].length === 0 && <p className="px-5 py-12 text-center text-xs text-muted-foreground">No {definition.label.toLowerCase()} configured.</p>}
        </div>
      </section>
    </div>}
    <ConfigDetailDialog selected={selected} onOpenChange={(open) => { if (!open) setSelected(null); }} />
  </div>;
}

function configCollections(config?: InstanceConfig): Record<Category, ConfigItem[]> {
  return {
    models: config?.models ?? [],
    skills: config?.skills ?? [],
    variables: config?.variables ?? [],
    memory: config?.sharedFolders ?? [],
  };
}

function ConfigDetailDialog({ selected, onOpenChange }: { selected: { category: Category; item: ConfigItem } | null; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={Boolean(selected)} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
      {selected && <><DialogHeader><DialogTitle>{itemName(selected.item)}</DialogTitle><DialogDescription>{categories.find((category) => category.key === selected.category)?.label} configuration</DialogDescription></DialogHeader><ConfigItemDetails category={selected.category} item={selected.item} /></>}
    </DialogContent>
  </Dialog>;
}

function ConfigItemDetails({ category, item }: { category: Category; item: ConfigItem }) {
  if (category === 'models') { const model = item as ModelInfo; return <DetailList rows={[['Provider', model.provider], ['Model', model.model]]} />; }
  if (category === 'variables') { const variable = item as VariableInfo; return <><DetailList rows={[['Kind', variable.secret ? 'Secret' : 'Variable'], ['Stored value', 'Managed in workspace Settings']]} />{variable.secret && <p className="rounded-md border bg-muted/50 p-3 text-xs text-muted-foreground">Command Center never returns the stored secret value to this configuration view.</p>}</>; }
  if (category === 'memory') { const memory = item as SharedFolderInfo; return <><DetailList rows={[['Label', memory.label], ['Path', memory.path], ['Scope', memory.isShared ? 'Workspace shared' : 'Mission'], ['Access', memory.editable ? 'Read and write' : 'Read-only']]} />{memory.description && <DetailBlock label="Description" value={memory.description} />}{memory.missions?.length ? <DetailBlock label="Missions" value={memory.missions.join(', ')} /> : null}</>; }
  if (category === 'skills') { const skill = item as SkillInfo; return <><DetailList rows={[['Scope', skill.agent ? `Agent · ${skill.agent}` : 'Workspace'], ['Tools', String(skill.tools?.length ?? 0)]]} />{skill.description && <DetailBlock label="Description" value={skill.description} />}{skill.instructions && <DetailBlock label="Instructions" value={skill.instructions} pre />}{skill.tools?.length ? <DetailBlock label="Tools" value={skill.tools.join('\n')} pre /> : null}</>; }
  return null;
}

function DetailList({ rows }: { rows: Array<[string, string]> }) { return <dl className="divide-y rounded-md border">{rows.map(([label, value]) => <div className="grid gap-1 px-3 py-2.5 sm:grid-cols-[8rem_1fr]" key={label}><dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt><dd className="break-all text-xs">{value || '—'}</dd></div>)}</dl>; }
function DetailBlock({ label, value, pre = false }: { label: string; value: string; pre?: boolean }) { return <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><div className={cn('rounded-md border bg-muted/30 p-3 text-xs leading-6', pre && 'whitespace-pre-wrap font-mono [overflow-wrap:anywhere]')}>{value}</div></div>; }
function itemName(item: ConfigItem) { return item.name; }
function itemKey(category: Category, item: ConfigItem) { return `${category}:${item.name}:${'agent' in item ? item.agent ?? '' : ''}`; }
function itemSummary(category: Category, item: ConfigItem) {
  if (category === 'models') { const value = item as ModelInfo; return `${value.provider} · ${value.model}`; }
  if (category === 'skills') { const value = item as SkillInfo; return value.description || (value.agent ? `Agent · ${value.agent}` : 'Workspace skill'); }
  if (category === 'variables') return (item as VariableInfo).secret ? 'Secret · value protected' : 'Variable';
  const value = item as SharedFolderInfo; return value.description || `${value.editable ? 'Read and write' : 'Read-only'} · ${value.missions?.length ?? 0} missions`;
}
function ConfigState({ text }: { text: string }) { return <div className="grid min-h-72 place-items-center rounded-md border bg-card px-6 text-center text-sm text-muted-foreground">{text}</div>; }

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Pause, Play, Trash2 } from 'lucide-react';
import { createMissionSchedule, deleteMissionSchedule, listMissionRunIdentities, listMissionSchedules, updateMissionSchedule } from '@/api/client';
import type { MissionInfo, MissionRunIdentity, MissionSchedule } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { describeSchedule } from '@/lib/schedule-display';

export function MissionSchedulesPanel({ createOpen, instanceId, mission, onCreateOpenChange, workspaceId }: { createOpen: boolean; instanceId: string; mission: MissionInfo; onCreateOpenChange: (open: boolean) => void; workspaceId: string }) {
  const queryClient = useQueryClient();
  const schedules = useQuery({ queryKey: ['mission-schedules', workspaceId, mission.name], queryFn: () => listMissionSchedules(workspaceId, mission.name) });
  const identities = useQuery({ queryKey: ['mission-run-identities', instanceId, mission.name], queryFn: () => listMissionRunIdentities(instanceId, mission.name), enabled: Boolean(instanceId), retry: false });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['mission-schedules', workspaceId, mission.name] });
  const remove = useMutation({ mutationFn: (id: string) => deleteMissionSchedule(workspaceId, mission.name, id), onSuccess: invalidate });
  const toggle = useMutation({ mutationFn: (schedule: MissionSchedule) => updateMissionSchedule(workspaceId, mission.name, schedule.id, toInput(schedule, schedule.status === 'active' ? 'paused' : 'active')), onSuccess: invalidate });

  return <section className="rounded-md border bg-card lg:col-span-2">
    <div className="flex items-center gap-2 border-b px-4 py-3"><CalendarClock className="size-3.5 text-muted-foreground" /><div><h2 className="text-xs font-semibold">Schedules</h2><p className="mt-0.5 text-[10px] text-muted-foreground">Time-based runs are managed centrally and continue independently of a connected browser.</p></div><span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{schedules.data?.length ?? 0}</span></div>
    <div className="px-4 py-2">
      {schedules.isLoading && <Empty text="Loading schedules…" />}
      {schedules.isError && <Empty text="Schedules could not be loaded." />}
      {schedules.data?.length === 0 && <Empty text="No scheduled runs." />}
      {schedules.data?.map((schedule) => <div className="flex items-center gap-4 border-b py-3 last:border-0" key={schedule.id}>
        <span className={`size-2 rounded-full ${schedule.status === 'active' ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
        <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{schedule.name || describeSchedule(schedule.cronExpression)}</p><p className="mt-1 text-[10px] text-muted-foreground">{schedule.name ? `${describeSchedule(schedule.cronExpression)} · ` : ''}{schedule.timezone} · {identityName(schedule, identities.data)}</p></div>
        <div className="hidden text-right sm:block"><p className="text-[10px] text-muted-foreground">{schedule.status === 'active' ? `Next ${formatDate(schedule.nextRunAt)}` : 'Paused'}</p>{schedule.lastRunAt && <p className="mt-1 text-[9px] text-muted-foreground">Last {schedule.lastRunStatus} · {formatDate(schedule.lastRunAt)}</p>}</div>
        <Button aria-label={schedule.status === 'active' ? 'Pause schedule' : 'Resume schedule'} disabled={toggle.isPending} onClick={() => toggle.mutate(schedule)} size="icon" variant="ghost">{schedule.status === 'active' ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</Button>
        <Button aria-label="Delete schedule" disabled={remove.isPending} onClick={() => remove.mutate(schedule.id)} size="icon" variant="ghost"><Trash2 className="size-3.5" /></Button>
      </div>)}
    </div>
    <ScheduleDialog identities={identities.data ?? []} mission={mission} onCreated={() => { onCreateOpenChange(false); invalidate(); }} onOpenChange={onCreateOpenChange} open={createOpen} workspaceId={workspaceId} />
  </section>;
}

function ScheduleDialog({ identities, mission, onCreated, onOpenChange, open, workspaceId }: { identities: MissionRunIdentity[]; mission: MissionInfo; onCreated: () => void; onOpenChange: (open: boolean) => void; open: boolean; workspaceId: string }) {
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom'>('weekdays');
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [weekday, setWeekday] = useState('1');
  const [expression, setExpression] = useState('0 9 * * 1-5');
  const [zone, setZone] = useState(timezone);
  const [identityKey, setIdentityKey] = useState('');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  useEffect(() => { if (open && !identityKey && identities[0]) setIdentityKey(`${identities[0].kind}:${identities[0].id}`); }, [identities, identityKey, open]);
  useEffect(() => { if (cadence !== 'custom') setExpression(expressionFor(cadence, timeOfDay, weekday)); }, [cadence, timeOfDay, weekday]);
  const selected = identities.find((identity) => `${identity.kind}:${identity.id}` === identityKey);
  const create = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('Choose an execution identity.');
      return createMissionSchedule(workspaceId, mission.name, { name, cronExpression: expression, timezone: zone, inputs, runAsKind: selected.kind, runAsId: selected.id, status: 'active' });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'The schedule could not be created.'),
    onSuccess: onCreated,
  });
  return <Dialog onOpenChange={onOpenChange} open={open}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Schedule {mission.name}</DialogTitle><DialogDescription>Set when this mission runs and which identity it uses.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <Field label="Name (optional)"><Input onChange={(event) => setName(event.target.value)} placeholder="Weekday morning run" value={name} /></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Repeats"><Select onValueChange={(value) => setCadence(value as typeof cadence)} value={cadence}><SelectTrigger className="w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hourly">Hourly</SelectItem><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekdays">Weekdays</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="custom">Custom cron</SelectItem></SelectContent></Select></Field>{cadence === 'hourly' ? <Field label="At minute"><Input max="59" min="0" onChange={(event) => setTimeOfDay(`00:${event.target.value.padStart(2, '0')}`)} type="number" value={Number(timeOfDay.split(':')[1])} /></Field> : cadence !== 'custom' ? <Field label="Time"><Input onChange={(event) => setTimeOfDay(event.target.value)} type="time" value={timeOfDay} /></Field> : null}</div>
      {cadence === 'weekly' && <Field label="Day"><Select onValueChange={setWeekday} value={weekday}><SelectTrigger className="w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Monday</SelectItem><SelectItem value="2">Tuesday</SelectItem><SelectItem value="3">Wednesday</SelectItem><SelectItem value="4">Thursday</SelectItem><SelectItem value="5">Friday</SelectItem><SelectItem value="6">Saturday</SelectItem><SelectItem value="0">Sunday</SelectItem></SelectContent></Select></Field>}
      {cadence === 'custom' && <Field label="Cron expression"><Input className="font-mono" onChange={(event) => setExpression(event.target.value)} value={expression} /></Field>}
      <Field label="Timezone"><Input onChange={(event) => setZone(event.target.value)} value={zone} /></Field>
      <Field label="Run as"><Select onValueChange={setIdentityKey} value={identityKey}><SelectTrigger className="w-full text-xs"><SelectValue placeholder="Choose identity" /></SelectTrigger><SelectContent>{identities.map((identity) => <SelectItem key={`${identity.kind}:${identity.id}`} value={`${identity.kind}:${identity.id}`}>{identity.kind === 'user' ? `Myself — ${identity.name}` : `${identity.name} — Service principal`}</SelectItem>)}</SelectContent></Select></Field>
      {mission.inputs?.map((input) => <Field key={input.name} label={`${input.name}${input.required ? ' · required' : ''}`}><Input onChange={(event) => setInputs((current) => ({ ...current, [input.name]: event.target.value }))} type={input.protected ? 'password' : 'text'} value={inputs[input.name] ?? ''} /></Field>)}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
    <DialogFooter><Button onClick={() => onOpenChange(false)} variant="outline">Cancel</Button><Button disabled={create.isPending || !expression.trim() || !selected} onClick={() => create.mutate()}><CalendarClock className="size-3.5" />{create.isPending ? 'Creating…' : 'Create schedule'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function Field({ children, label }: { children: React.ReactNode; label: string }) { return <label className="block text-xs font-medium"><span className="mb-2 block">{label}</span>{children}</label>; }
function Empty({ text }: { text: string }) { return <p className="py-5 text-center text-[11px] text-muted-foreground">{text}</p>; }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function identityName(schedule: MissionSchedule, identities?: MissionRunIdentity[]) { const id = schedule.runAsUserId ?? schedule.runAsServicePrincipalId; return identities?.find((identity) => identity.id === id)?.name ?? (schedule.runAsUserId ? 'User' : 'Service principal'); }
function toInput(schedule: MissionSchedule, status: 'active' | 'paused') { return { name: schedule.name, cronExpression: schedule.cronExpression, timezone: schedule.timezone, inputs: schedule.inputs ?? {}, runAsKind: schedule.runAsUserId ? 'user' as const : 'service_principal' as const, runAsId: schedule.runAsUserId ?? schedule.runAsServicePrincipalId ?? '', status }; }
function expressionFor(cadence: 'hourly' | 'daily' | 'weekdays' | 'weekly', value: string, weekday: string) { const [hour = '9', minute = '0'] = value.split(':').map((part) => String(Number(part))); if (cadence === 'hourly') return `${minute} * * * *`; if (cadence === 'weekdays') return `${minute} ${hour} * * 1-5`; if (cadence === 'weekly') return `${minute} ${hour} * * ${weekday}`; return `${minute} ${hour} * * *`; }

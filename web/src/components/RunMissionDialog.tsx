import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { listMissionRunIdentities, runMission } from '@/api/client';
import type { MissionInfo, MissionInputInfo } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type FileValue = { filename: string; content_base64: string };
type FormValue = string | boolean | FileValue;

export function RunMissionDialog({ buttonClassName, connected, instanceId, mission, workspaceId }: { buttonClassName?: string; connected: boolean; instanceId: string; mission: MissionInfo; workspaceId: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, FormValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedIdentityKey, setSelectedIdentityKey] = useState('');
  const identities = useQuery({
    queryKey: ['mission-run-identities', instanceId, mission.name],
    queryFn: () => listMissionRunIdentities(instanceId, mission.name),
    enabled: Boolean(connected && instanceId),
    retry: false,
  });
  const eligibleIdentities = identities.data ?? [];
  const selectedIdentity = eligibleIdentities.find((identity) => `${identity.kind}:${identity.id}` === selectedIdentityKey) ?? eligibleIdentities[0];
  const canRun = connected && identities.isSuccess && eligibleIdentities.length > 0;
  const unavailableReason = !connected
    ? 'Workspace disconnected.'
    : identities.isLoading
      ? 'Checking access…'
      : identities.isError
        ? 'Unable to check access.'
        : !eligibleIdentities.length
          ? 'You can’t run this mission.'
          : '';

  const submit = async () => {
    const nextErrors = validateInputs(mission.inputs ?? [], values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    setError('');
    try {
      if (!selectedIdentity) return;
      const result = await runMission(instanceId, mission.name, serializeInputs(mission.inputs ?? [], values), selectedIdentity.kind === 'service_principal' ? selectedIdentity.id : undefined);
      setOpen(false);
      navigate(`/w/${workspaceId}/missions/${encodeURIComponent(mission.name)}/runs/${encodeURIComponent(result.missionId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The mission could not be started.');
    } finally {
      setSubmitting(false);
    }
  };

  return <>
    <span aria-describedby={!canRun ? `run-mission-reason-${mission.name}` : undefined} className="group relative inline-flex" tabIndex={!canRun ? 0 : undefined}>
      <Button className={cn(buttonClassName)} disabled={!canRun} onClick={() => setOpen(true)} size="sm"><Play className="size-3.5" />Run mission</Button>
      {!canRun && <span className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-max max-w-72 translate-y-1 rounded-md border bg-popover px-3 py-2 text-left text-[11px] font-normal leading-4 text-popover-foreground opacity-0 shadow-md transition-[opacity,transform] duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100" id={`run-mission-reason-${mission.name}`} role="tooltip">{unavailableReason}</span>}
    </span>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Run {mission.name}</DialogTitle><DialogDescription>{mission.inputs?.length ? 'Choose an execution identity and provide the inputs for this run.' : 'Choose the identity that will execute this run.'}</DialogDescription></DialogHeader>
        <div>
          <label className="text-xs font-medium" htmlFor={`run-as-${mission.name}`}>Run as</label>
          <p className="mb-2 mt-1 text-[10px] leading-4 text-muted-foreground">The selected identity determines the run permissions and recorded execution identity.</p>
          <Select disabled={eligibleIdentities.length < 2} onValueChange={setSelectedIdentityKey} value={selectedIdentity ? `${selectedIdentity.kind}:${selectedIdentity.id}` : ''}><SelectTrigger className="w-full text-xs" id={`run-as-${mission.name}`}><SelectValue placeholder="Choose identity" /></SelectTrigger><SelectContent>{eligibleIdentities.map((identity) => <SelectItem key={`${identity.kind}:${identity.id}`} value={`${identity.kind}:${identity.id}`}>{identity.kind === 'user' ? `Myself — ${identity.name}` : `${identity.name} — Service principal`}</SelectItem>)}</SelectContent></Select>
        </div>
        {mission.inputs?.length ? <div className="space-y-4 py-1">{mission.inputs.map((input) => <MissionInputField error={errors[input.name]} input={input} key={input.name} onChange={(value) => setValues((current) => ({ ...current, [input.name]: value }))} value={values[input.name]} />)}</div> : null}
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
        <DialogFooter><Button disabled={submitting} onClick={() => setOpen(false)} variant="outline">Cancel</Button><Button disabled={submitting || !selectedIdentity} onClick={submit}><Play className="size-3.5" />{submitting ? 'Starting…' : 'Start run'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function MissionInputField({ error, input, onChange, value }: { error?: string; input: MissionInputInfo; onChange: (value: FormValue) => void; value?: FormValue }) {
  const type = input.type || 'string';
  const id = `mission-input-${input.name}`;
  const stringValue = typeof value === 'string' ? value : '';
  return <div>
    <label className="flex items-baseline gap-2 text-xs font-medium" htmlFor={id}>{input.name}{input.required && <span className="text-destructive">Required</span>}<span className="ml-auto text-[10px] font-normal text-muted-foreground">{type}</span></label>
    {input.description && <p className="mb-2 mt-1 text-[10px] leading-4 text-muted-foreground">{input.description}</p>}
    {type === 'bool' ? <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-xs" htmlFor={id}><input checked={value === true} id={id} onChange={(event) => onChange(event.target.checked)} type="checkbox" />{value === true ? 'true' : 'false'}</label>
      : type === 'file' ? <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs" htmlFor={id}><Upload className="size-3.5 text-muted-foreground" /><span className="truncate">{isFileValue(value) ? value.filename : 'Choose a file'}</span><input className="sr-only" id={id} onChange={(event) => { const file = event.target.files?.[0]; if (file) readFile(file).then(onChange); }} type="file" /></label>
      : isStructured(type) ? <textarea aria-invalid={Boolean(error)} className="mt-2 min-h-28 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" id={id} onChange={(event) => onChange(event.target.value)} placeholder={type === 'list' ? '["item"]' : '{"key":"value"}'} value={stringValue} />
      : <Input aria-invalid={Boolean(error)} id={id} onChange={(event) => onChange(event.target.value)} step={type === 'integer' ? '1' : type === 'number' ? 'any' : undefined} type={input.protected ? 'password' : type === 'number' || type === 'integer' ? 'number' : 'text'} value={stringValue} />}
    {error && <p className="mt-1 text-[10px] text-destructive">{error}</p>}
  </div>;
}

function validateInputs(inputs: MissionInputInfo[], values: Record<string, FormValue>) {
  const errors: Record<string, string> = {};
  inputs.forEach((input) => {
    const value = values[input.name];
    const empty = value == null || value === '';
    if (input.required && empty) errors[input.name] = 'This input is required.';
    if (!empty && isStructured(input.type || '') && typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        const valid = input.type === 'list' ? Array.isArray(parsed) : Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
        if (!valid) errors[input.name] = input.type === 'list' ? 'Enter a JSON array.' : 'Enter a JSON object.';
      } catch { errors[input.name] = 'Enter valid JSON.'; }
    }
    if (!empty && input.type === 'integer' && !Number.isInteger(Number(value))) errors[input.name] = 'Enter a whole number.';
  });
  return errors;
}

function serializeInputs(inputs: MissionInputInfo[], values: Record<string, FormValue>) {
  const result: Record<string, string> = {};
  inputs.forEach((input) => {
    const value = values[input.name];
    if (value == null || value === '') return;
    result[input.name] = isFileValue(value) ? JSON.stringify(value) : String(value);
  });
  return result;
}
function isStructured(type: string) { return type === 'list' || type === 'map' || type === 'object'; }
function isFileValue(value: FormValue | undefined): value is FileValue { return Boolean(value && typeof value === 'object' && 'content_base64' in value); }
function readFile(file: File): Promise<FileValue> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { const data = String(reader.result ?? ''); resolve({ filename: file.name, content_base64: data.slice(data.indexOf(',') + 1) }); }; reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }

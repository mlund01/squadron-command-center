import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { runMission } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MissionInfo, MissionInputInfo } from '@/api/types';

interface RunMissionDialogProps {
  instanceId: string;
  mission: MissionInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Format a human-readable type label */
function typeLabel(inp: MissionInputInfo): string {
  const t = inp.type || 'string';
  if (t === 'list') {
    return `list<${inp.items ? typeLabel(inp.items) : 'any'}>`;
  }
  if (t === 'map') {
    return `map<string, ${inp.items ? typeLabel(inp.items) : 'any'}>`;
  }
  return t;
}

/** Render a single input field, potentially nested */
function InputControl({
  inp,
  value,
  onChange,
  depth = 0,
}: {
  inp: MissionInputInfo;
  value: any;
  onChange: (val: any) => void;
  depth?: number;
}) {
  const type = inp.type || 'string';

  if (type === 'bool') {
    return (
      <div className="flex items-center gap-2">
        <Switch
          checked={value === true || value === 'true'}
          onCheckedChange={(checked) => onChange(checked)}
        />
        <span className="text-xs text-muted-foreground">{value === true || value === 'true' ? 'true' : 'false'}</span>
      </div>
    );
  }

  if (type === 'integer') {
    return (
      <Input
        type="number"
        step="1"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder="0"
      />
    );
  }

  if (type === 'number') {
    return (
      <Input
        type="number"
        step="any"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder="0.0"
      />
    );
  }

  if (type === 'object' && inp.properties && inp.properties.length > 0) {
    const objValue = (typeof value === 'object' && value && !Array.isArray(value)) ? value : {};
    return (
      <div className={cn('space-y-3 rounded-lg border border-border/60 p-3', depth > 0 && 'bg-muted/10')}>
        {inp.properties.map((prop) => (
          <div key={prop.name}>
            <label className="block text-sm font-medium mb-1">
              {prop.name}
              {prop.required && <span className="text-destructive ml-1">*</span>}
              <span className="text-[10px] text-muted-foreground ml-2">{typeLabel(prop)}</span>
            </label>
            {prop.description && (
              <p className="text-xs text-muted-foreground mb-1">{prop.description}</p>
            )}
            <InputControl
              inp={prop}
              value={objValue[prop.name]}
              onChange={(v) => onChange({ ...objValue, [prop.name]: v })}
              depth={depth + 1}
            />
          </div>
        ))}
      </div>
    );
  }

  if (type === 'list' && inp.items && ['string', 'number', 'integer', 'bool'].includes(inp.items.type || 'string')) {
    const arrValue = Array.isArray(value) ? value : [];
    const itemType = inp.items.type || 'string';
    return (
      <div className="space-y-1.5">
        {arrValue.map((item: any, i: number) => (
          <div key={i} className="flex gap-2 items-center">
            {itemType === 'bool' ? (
              <div className="flex items-center gap-2 flex-1">
                <Switch
                  checked={item === true}
                  onCheckedChange={(checked) => {
                    const next = [...arrValue];
                    next[i] = checked;
                    onChange(next);
                  }}
                />
                <span className="text-xs text-muted-foreground">{item ? 'true' : 'false'}</span>
              </div>
            ) : (
              <Input
                className="flex-1"
                type={itemType === 'number' || itemType === 'integer' ? 'number' : 'text'}
                step={itemType === 'integer' ? '1' : 'any'}
                value={item ?? ''}
                onChange={(e) => {
                  const next = [...arrValue];
                  next[i] = itemType === 'number' || itemType === 'integer' ? Number(e.target.value) : e.target.value;
                  onChange(next);
                }}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => onChange(arrValue.filter((_: any, j: number) => j !== i))}
            >
              ×
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => {
            const empty = itemType === 'bool' ? false : itemType === 'number' || itemType === 'integer' ? 0 : '';
            onChange([...arrValue, empty]);
          }}
        >
          + Add item
        </Button>
      </div>
    );
  }

  // Map with primitive value types — key-value pair editor
  if (type === 'map' && inp.items && ['string', 'number', 'integer', 'bool'].includes(inp.items.type || 'string')) {
    const mapValue = (typeof value === 'object' && value && !Array.isArray(value)) ? value as Record<string, any> : {};
    const entries = Object.entries(mapValue);
    const valType = inp.items.type || 'string';
    return (
      <div className="space-y-1.5">
        {entries.map(([k, v], i) => (
          <div key={i} className="flex gap-2 items-center">
            <Input
              className="w-[40%]"
              value={k}
              placeholder="key"
              onChange={(e) => {
                const newMap: Record<string, any> = {};
                for (const [ok, ov] of Object.entries(mapValue)) {
                  newMap[ok === k ? e.target.value : ok] = ov;
                }
                onChange(newMap);
              }}
            />
            {valType === 'bool' ? (
              <div className="flex items-center gap-2 flex-1">
                <Switch
                  checked={v === true}
                  onCheckedChange={(checked) => onChange({ ...mapValue, [k]: checked })}
                />
              </div>
            ) : (
              <Input
                className="flex-1"
                type={valType === 'number' || valType === 'integer' ? 'number' : 'text'}
                step={valType === 'integer' ? '1' : 'any'}
                value={v ?? ''}
                placeholder="value"
                onChange={(e) => {
                  const newVal = valType === 'number' || valType === 'integer' ? Number(e.target.value) : e.target.value;
                  onChange({ ...mapValue, [k]: newVal });
                }}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => {
                const { [k]: _, ...rest } = mapValue;
                onChange(rest);
              }}
            >
              ×
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => {
            const emptyVal = valType === 'bool' ? false : valType === 'number' || valType === 'integer' ? 0 : '';
            onChange({ ...mapValue, '': emptyVal });
          }}
        >
          + Add entry
        </Button>
      </div>
    );
  }

  // Fallback for complex map, unschematized object, complex list — JSON textarea
  if (type === 'list' || type === 'map' || type === 'object') {
    const strValue = typeof value === 'string' ? value :
      (value != null ? JSON.stringify(value, null, 2) : '');
    return (
      <textarea
        className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
        rows={3}
        value={strValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={type === 'list' ? '["item1", "item2"]' : '{"key": "value"}'}
      />
    );
  }

  // Default: string
  return (
    <Input
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={type}
    />
  );
}

/** Validate inputs against schema, returns map of field name -> error message */
function validateInputs(inputs: Record<string, any>, schema: MissionInputInfo[]): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const inp of schema) {
    const val = inputs[inp.name];
    const type = inp.type || 'string';
    const isEmpty = val === undefined || val === '' || val === null;

    // Required check
    if (inp.required && isEmpty) {
      errors[inp.name] = 'Required';
      continue;
    }
    if (isEmpty) continue;

    // Type-specific validation
    if (type === 'integer') {
      const n = Number(val);
      if (isNaN(n) || !Number.isInteger(n)) {
        errors[inp.name] = 'Must be a whole number';
      }
    } else if (type === 'number') {
      if (isNaN(Number(val))) {
        errors[inp.name] = 'Must be a number';
      }
    } else if (type === 'list') {
      if (typeof val === 'string') {
        try { const parsed = JSON.parse(val); if (!Array.isArray(parsed)) errors[inp.name] = 'Must be a JSON array'; }
        catch { errors[inp.name] = 'Invalid JSON'; }
      }
    } else if (type === 'map' || type === 'object') {
      if (typeof val === 'string') {
        try { const parsed = JSON.parse(val); if (typeof parsed !== 'object' || Array.isArray(parsed)) errors[inp.name] = 'Must be a JSON object'; }
        catch { errors[inp.name] = 'Invalid JSON'; }
      }
      // Validate object properties recursively
      if (type === 'object' && inp.properties && typeof val === 'object' && !Array.isArray(val)) {
        const nested = validateInputs(val, inp.properties);
        for (const [k, v] of Object.entries(nested)) {
          errors[`${inp.name}.${k}`] = v;
        }
      }
      // Validate map has no empty keys
      if (type === 'map' && typeof val === 'object' && !Array.isArray(val)) {
        if (Object.keys(val).some(k => k.trim() === '')) {
          errors[inp.name] = 'All keys must be non-empty';
        }
      }
    }
  }

  return errors;
}

/** Serialize form values to string map for the API */
function serializeInputs(inputs: Record<string, any>, schema: MissionInputInfo[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const inp of schema) {
    const val = inputs[inp.name];
    if (val === undefined || val === '') continue;
    const type = inp.type || 'string';
    if (type === 'string') {
      result[inp.name] = String(val);
    } else if (type === 'bool') {
      result[inp.name] = val === true || val === 'true' ? 'true' : 'false';
    } else if (type === 'number' || type === 'integer') {
      result[inp.name] = String(val);
    } else if (typeof val === 'string') {
      // Already JSON string from textarea
      result[inp.name] = val;
    } else {
      result[inp.name] = JSON.stringify(val);
    }
  }
  return result;
}

export function RunMissionDialog({ instanceId, mission, open, onOpenChange }: RunMissionDialogProps) {
  const navigate = useNavigate();
  const [inputs, setInputs] = useState<Record<string, any>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleRun = async () => {
    const errs = validateInputs(inputs, mission.inputs || []);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setRunning(true);
    setError(null);
    try {
      const serialized = serializeInputs(inputs, mission.inputs || []);
      const result = await runMission(instanceId, mission.name, serialized);
      onOpenChange(false);
      navigate(`/instances/${instanceId}/runs/${result.missionId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const hasInputs = mission.inputs && mission.inputs.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Run: {mission.name}</DialogTitle>
          {mission.description && (
            <DialogDescription>{mission.description}</DialogDescription>
          )}
        </DialogHeader>

        {hasInputs ? (
          <div className="space-y-4 py-2">
            {mission.inputs!.map((inp) => {
              const err = fieldErrors[inp.name];
              return (
                <div key={inp.name}>
                  <label className="flex items-center gap-1.5 text-sm font-medium mb-1">
                    {inp.name}
                    {inp.required && <span className="text-destructive">*</span>}
                    <span className="text-[10px] text-muted-foreground">{typeLabel(inp)}</span>
                    {inp.protected && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-0 font-medium">
                        <ShieldCheck className="size-3" />
                        protected
                      </span>
                    )}
                  </label>
                  {inp.description && (
                    <p className="text-xs text-muted-foreground mb-1">{inp.description}</p>
                  )}
                  <InputControl
                    inp={inp}
                    value={inputs[inp.name]}
                    onChange={(val) => {
                      setInputs(prev => ({ ...prev, [inp.name]: val }));
                      if (fieldErrors[inp.name]) setFieldErrors(prev => { const { [inp.name]: _, ...rest } = prev; return rest; });
                    }}
                  />
                  {err && <p className="text-xs text-destructive mt-1">{err}</p>}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-2">This mission has no inputs.</p>
        )}

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <DialogFooter>
          <Button onClick={handleRun} disabled={running}>
            {running ? 'Starting...' : 'Run Mission'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

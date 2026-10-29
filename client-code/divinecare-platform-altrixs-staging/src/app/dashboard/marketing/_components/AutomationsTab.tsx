'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, Play, Plus, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, FormField, IconButton, LoadingState, Modal, StatusBadge } from '@/components/ui';
import { Checkbox, Select, TextArea, TextInput, post, useApi } from './shared';

type Step = { type: string; body?: string; subject?: string; title?: string; dueInHours?: number; hours?: number; hoursBefore?: number; stage?: string; message?: string; userId?: string };
type Trigger = { type: string; toStage?: string; sources?: string[]; hours?: number; maxRating?: number };
type Wf = { id: string; name: string; recipeKey: string | null; trigger: Trigger; steps: Step[]; active: boolean; runs: Record<string, number> };
type Data = {
  workflows: Wf[];
  recipes: { key: string; name: string; description: string; installed: boolean }[];
  triggerTypes: { key: string; label: string }[];
  stepTypes: { key: string; label: string }[];
  stages: { key: string; label: string }[];
  sources: { key: string; label: string }[];
};

export function AutomationsTab() {
  const { data, error, loading, reload } = useApi<Data>('/api/marketing/automations');
  const [editing, setEditing] = useState<Wf | 'new' | null>(null);
  const act = async (body: Record<string, unknown>, msg: string) => {
    try {
      await post('/api/marketing/automations', body);
      toast.success(msg);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    }
  };
  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState rows={4} />;
  if (!data) return null;
  const label = (list: { key: string; label: string }[], k: string) => list.find((x) => x.key === k)?.label ?? k;
  return (
    <div className="space-y-4">
      <Alert tone="info" title="Safe by design">
        Every text and email step checks consent (SMS consent, STOP, unsubscribe, quiet hours, CAN-SPAM address, HIPAA marketing authorization for clients). Lead workflows stop when the lead replies (if the step says so), closes, or converts to a client. Appointment reminders for clients stay in the clinical reminder system.
      </Alert>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" icon={<Play className="h-4 w-4" aria-hidden />} onClick={() => act({ action: 'run_due' }, 'Due automations processed')}>Run due now</Button>
        <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEditing('new')}>New workflow</Button>
      </div>
      <Card>
        <CardHeader title="Recipes" description="Pre-built workflows. They install turned off so you can review them first." />
        <ul className="divide-y divide-slate-100">
          {data.recipes.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <div className="min-w-0"><p className="text-sm font-medium text-slate-900">{r.name}</p><p className="text-xs text-slate-500">{r.description}</p></div>
              {r.installed ? <StatusBadge tone="success" size="sm">Installed</StatusBadge> : <Button size="sm" variant="secondary" onClick={() => act({ action: 'install', recipeKey: r.key }, 'Recipe installed (off)')}>Install</Button>}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Workflows" />
        {!data.workflows.length ? (
          <EmptyState icon={<WorkflowIcon aria-hidden />} title="No workflows" description="Install a recipe or build your own." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.workflows.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{w.name}</p>
                  <p className="text-xs text-slate-500">When: {label(data.triggerTypes, w.trigger.type)}{w.trigger.toStage ? ` (${label(data.stages, w.trigger.toStage)})` : ''}{w.trigger.hours ? ` (${w.trigger.hours}h)` : ''} · {w.steps.length} steps · running {(w.runs.active ?? 0) + (w.runs.waiting ?? 0)}, done {w.runs.completed ?? 0}, stopped {w.runs.stopped ?? 0}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox label={w.active ? 'On' : 'Off'} checked={w.active} onChange={(v) => act({ action: 'toggle', id: w.id, active: v }, v ? 'Workflow on' : 'Workflow off (running sequences stopped)')} />
                  <Button size="sm" variant="ghost" onClick={() => setEditing(w)}>Edit</Button>
                  <IconButton label="Delete workflow" icon={<Trash2 className="h-4 w-4" />} onClick={() => window.confirm('Delete this workflow and stop its runs?') && act({ action: 'delete', id: w.id }, 'Deleted')} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing ? <Builder data={data} wf={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} /> : null}
    </div>
  );
}

function Builder({ data, wf, onClose, onSaved }: { data: Data; wf: Wf | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(wf?.name ?? '');
  const [trigger, setTrigger] = useState<Trigger>(wf?.trigger ?? { type: 'lead_created' });
  const [steps, setSteps] = useState<Step[]>(wf?.steps ?? [{ type: 'send_sms', body: '' }]);
  const [busy, setBusy] = useState(false);
  const setStep = (i: number, s: Partial<Step>) => setSteps(steps.map((x, j) => (j === i ? { ...x, ...s } : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const n = [...steps];
    [n[i], n[j]] = [n[j], n[i]];
    setSteps(n);
  };
  const save = async () => {
    setBusy(true);
    try {
      await post('/api/marketing/automations', { action: 'save', id: wf?.id, name, trigger, steps });
      toast.success('Workflow saved');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={wf ? 'Edit workflow' : 'New workflow'} size="xl" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={name.trim().length < 2} onClick={save}>Save workflow</Button></>}>
      <div className="space-y-4">
        <FormField label="Name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Trigger">
            <Select value={trigger.type} onChange={(e) => setTrigger({ type: e.target.value })}>
              {data.triggerTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </Select>
          </FormField>
          {trigger.type === 'stage_changed' ? (
            <FormField label="To stage">
              <Select value={trigger.toStage ?? ''} onChange={(e) => setTrigger({ ...trigger, toStage: e.target.value || undefined })}>
                <option value="">Any</option>
                {data.stages.filter((s) => s.key !== 'converted').map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </Select>
            </FormField>
          ) : null}
          {trigger.type === 'no_response' ? <FormField label="Hours without reply"><TextInput type="number" min={1} value={trigger.hours ?? 48} onChange={(e) => setTrigger({ ...trigger, hours: Number(e.target.value) })} /></FormField> : null}
          {trigger.type === 'review_received' ? <FormField label="Only ratings at or below"><TextInput type="number" min={1} max={5} value={trigger.maxRating ?? 5} onChange={(e) => setTrigger({ ...trigger, maxRating: Number(e.target.value) })} /></FormField> : null}
          {trigger.type === 'lead_created' ? (
            <FormField label="Only these sources" hint="Leave empty for all">
              <Select multiple value={trigger.sources ?? []} onChange={(e) => setTrigger({ ...trigger, sources: Array.from(e.target.selectedOptions).map((o) => o.value) })} className="h-24">
                {data.sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </Select>
            </FormField>
          ) : null}
        </div>
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <span className="pb-2 text-xs font-semibold text-slate-500">Step {i + 1}</span>
                <FormField label="Action" className="min-w-[220px] flex-1">
                  <Select value={s.type} onChange={(e) => setStep(i, { type: e.target.value })}>
                    {data.stepTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </Select>
                </FormField>
                <IconButton label="Move up" icon={<ArrowUp className="h-4 w-4" />} onClick={() => move(i, -1)} />
                <IconButton label="Move down" icon={<ArrowDown className="h-4 w-4" />} onClick={() => move(i, 1)} />
                <IconButton label="Remove step" icon={<Trash2 className="h-4 w-4" />} onClick={() => setSteps(steps.filter((_, j) => j !== i))} />
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {s.type === 'send_email' ? <FormField label="Subject"><TextInput value={s.subject ?? ''} onChange={(e) => setStep(i, { subject: e.target.value })} /></FormField> : null}
                {s.type === 'send_sms' || s.type === 'send_email' ? (
                  <FormField label="Message" hint="Tokens: {{firstName}} {{practiceName}} {{practicePhone}} {{eventName}} {{eventDate}}. No clinical details." className="sm:col-span-2">
                    <TextArea rows={3} value={s.body ?? ''} onChange={(e) => setStep(i, { body: e.target.value })} />
                  </FormField>
                ) : null}
                {s.type === 'wait' ? <FormField label="Hours"><TextInput type="number" min={1} value={s.hours ?? 24} onChange={(e) => setStep(i, { hours: Number(e.target.value) })} /></FormField> : null}
                {s.type === 'wait_until_event' ? <FormField label="Hours before the event"><TextInput type="number" min={0} value={s.hoursBefore ?? 24} onChange={(e) => setStep(i, { hoursBefore: Number(e.target.value) })} /></FormField> : null}
                {s.type === 'create_task' ? (
                  <>
                    <FormField label="Task"><TextInput value={s.title ?? ''} onChange={(e) => setStep(i, { title: e.target.value })} /></FormField>
                    <FormField label="Due in hours"><TextInput type="number" min={0} step="0.25" value={s.dueInHours ?? 1} onChange={(e) => setStep(i, { dueInHours: Number(e.target.value) })} /></FormField>
                  </>
                ) : null}
                {s.type === 'move_stage' ? (
                  <FormField label="Stage">
                    <Select value={s.stage ?? ''} onChange={(e) => setStep(i, { stage: e.target.value })}>
                      <option value="">Choose</option>
                      {data.stages.filter((x) => x.key !== 'converted').map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </Select>
                  </FormField>
                ) : null}
                {s.type === 'notify_staff' ? <FormField label="Notification" className="sm:col-span-2"><TextInput value={s.message ?? ''} onChange={(e) => setStep(i, { message: e.target.value })} /></FormField> : null}
              </div>
            </li>
          ))}
        </ol>
        <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setSteps([...steps, { type: 'wait', hours: 24 }])}>Add step</Button>
        <CardBody className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">New workflows save turned off. Turn them on from the list after review.</CardBody>
      </div>
    </Modal>
  );
}

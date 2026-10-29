'use client';

import { useEffect, useState } from 'react';
import {
  Send,
  RefreshCw,
  Smartphone,
  CheckCircle2,
  Clock,
  Pill,
  Calendar,
  MessageSquare,
  Video,
  PlusCircle,
  Check,
  Cloud,
  Bell,
} from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  FOCUS_RING,
  FormField,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  cx,
  inputClasses,
  type TabItem,
} from '@/components/ui';

interface NotificationState {
  firebase: {
    configured: boolean;
    isMock: boolean;
    projectId: string | null;
    clientEmail: string | null;
    appName: string | null;
  };
  stats: {
    totalRegisteredDevices: number;
    patientsWithDevices: number;
  };
  clientsWithTokens: Array<{
    id: string;
    name: string;
    deviceTokens: Array<{
      id: string;
      platform: string;
      createdAt: string;
    }>;
  }>;
  allClients?: Array<{
    id: string;
    name: string;
    deviceTokens: Array<{ id: string; platform: string }>;
  }>;
  recentLogs: Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    successCount: number;
    failureCount: number;
    dedupeKey: string | null;
    sentAt: string;
    /** Medication details hidden by the server for this role (canViewClientMedications). */
    masked?: boolean;
  }>;
  /** false: the server masks medication reminders and refuses medication pushes for this role. */
  medicationDetails?: boolean;
}

interface MedicationScheduleItem {
  id: string;
  clientId: string;
  patientName: string;
  hasMobileApp: boolean;
  deviceCount: number;
  medicationName: string;
  dosage: string;
  instructions?: string;
  doseTimes: string[];
  startDate: string;
  endDate?: string | null;
  todayDoses: Array<{
    time: string;
    taken: boolean;
    takenAt?: string | null;
    skipped: boolean;
  }>;
}

export default function NotificationsDashboardPage() {
  const [data, setData] = useState<NotificationState | null>(null);
  const [medications, setMedications] = useState<MedicationScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMeds, setLoadingMeds] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active view tab
  const [activeTab, setActiveTab] = useState<'medications' | 'test_push' | 'schedulers'>('medications');

  // Direct Push Form State
  const [targetMode, setTargetMode] = useState<'patient' | 'token'>('patient');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [rawToken, setRawToken] = useState('');
  const [type, setType] = useState('medication_reminder');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<any>(null);

  // Prescribe Medicine Form State
  const [medPatientId, setMedPatientId] = useState('');
  const [medName, setMedName] = useState('');
  const [medDosage, setMedDosage] = useState('');
  const [medInstructions, setMedInstructions] = useState('');
  const [doseMorning, setDoseMorning] = useState(false); // 08:00
  const [doseAfternoon, setDoseAfternoon] = useState(false); // 13:00
  const [doseNight, setDoseNight] = useState(false); // 21:00
  const [customDoseTime, setCustomDoseTime] = useState('');
  const [assigningMed, setAssigningMed] = useState(false);
  const [assignMedResult, setAssignMedResult] = useState<any>(null);

  // Medication names / doses only for roles with canViewClientMedications (the server decides; the
  // page just hides what the API would refuse). Unknown until the first load: treat as hidden.
  const medsAllowed = data?.medicationDetails === true;

  async function loadData(): Promise<NotificationState | null> {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/notifications');
      if (!res.ok) throw new Error('Failed to load notification settings');
      const json = await res.json();
      setData(json);
      if (json.medicationDetails !== true) {
        // No medication tab or medication push for this role: start on a non-medication push.
        setActiveTab((t) => (t === 'medications' ? 'test_push' : t));
        if (type === 'medication_reminder') handleTypeChange('appointment_reminder');
      }

      const defaultClient = json.clientsWithTokens?.[0]?.id || json.allClients?.[0]?.id || '';
      if (!selectedClientId && defaultClient) {
        setSelectedClientId(defaultClient);
      }
      if (!medPatientId && defaultClient) {
        setMedPatientId(defaultClient);
      }
      return json;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function loadMedications() {
    try {
      setLoadingMeds(true);
      const res = await fetch('/api/clinical/medications');
      if (!res.ok) throw new Error('Failed to load medications');
      const json = await res.json();
      setMedications(json.medications || []);
    } catch (err) {
      console.error('Failed to fetch medications:', err);
    } finally {
      setLoadingMeds(false);
    }
  }

  async function loadAll() {
    const json = await loadData();
    if (json?.medicationDetails === true) await loadMedications();
    else setMedications([]);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching type only changes the generic title; the message is always typed by
  // staff — no sample drug, provider or patient names are pre-filled.
  const TYPE_TITLES: Record<string, string> = {
    medication_reminder: 'Medication Reminder',
    appointment_reminder: 'Upcoming Appointment Reminder',
    chat_message: 'New Message from Clinician',
    telehealth_call: 'Telehealth Session Started',
  };

  function handleTypeChange(newType: string) {
    setType(newType);
    setTitle(TYPE_TITLES[newType] ?? '');
    setMessage('');
  }

  async function handleSendTest(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setSendResult(null);

    try {
      const payload: any = { type, title, message };

      if (targetMode === 'token') {
        if (!rawToken.trim()) {
          alert('Please enter an FCM device token');
          setSending(false);
          return;
        }
        payload.token = rawToken.trim();
      } else {
        if (!selectedClientId) {
          alert('Please select a patient with a registered device');
          setSending(false);
          return;
        }
        payload.clientId = selectedClientId;
      }

      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      setSendResult(json);
      loadData();
    } catch (err) {
      setSendResult({
        success: false,
        error: err instanceof Error ? err.message : 'Send failed',
      });
    } finally {
      setSending(false);
    }
  }

  async function handleAssignMedicine(e: React.FormEvent) {
    e.preventDefault();
    setAssigningMed(true);
    setAssignMedResult(null);

    const times: string[] = [];
    if (doseMorning) times.push('08:00');
    if (doseAfternoon) times.push('13:00');
    if (doseNight) times.push('21:00');
    if (customDoseTime.trim() && !times.includes(customDoseTime.trim())) {
      times.push(customDoseTime.trim());
    }

    if (times.length === 0) {
      alert('Please select at least one dose timing (e.g. Morning, Afternoon, or Night)');
      setAssigningMed(false);
      return;
    }

    const patientId = medPatientId || selectedClientId;
    if (!patientId) {
      alert('Please select a patient');
      setAssigningMed(false);
      return;
    }

    try {
      const res = await fetch('/api/clinical/medications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: patientId,
          medicationName: medName,
          dosage: medDosage,
          instructions: medInstructions,
          doseTimes: times,
          daysSupply: 30,
          notifyPatient: true,
        }),
      });

      const json = await res.json();
      setAssignMedResult(json);
      loadMedications();
      loadData();
    } catch (err) {
      setAssignMedResult({
        success: false,
        error: err instanceof Error ? err.message : 'Assignment failed',
      });
    } finally {
      setAssigningMed(false);
    }
  }

  async function handleMarkTaken(scheduleId: string, doseTime: string, clientId: string) {
    try {
      const res = await fetch('/api/clinical/medications/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId,
          doseTime,
          status: 'taken',
          clientId,
        }),
      });
      if (res.ok) {
        loadMedications();
      }
    } catch (err) {
      console.error('Failed to mark taken:', err);
    }
  }

  async function handleSendInstantDoseReminder(med: MedicationScheduleItem, doseTime: string) {
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: med.clientId,
          type: 'medication_reminder',
          title: `Medication Reminder: ${med.medicationName}`,
          message: `Time for your ${med.dosage} dose (${doseTime}). Instructions: ${med.instructions || 'Take as prescribed'}.`,
        }),
      });
      const json = await res.json();
      alert(json.success ? 'Dose reminder push sent to patient phone.' : `Push error: ${json.error || 'Check tokens'}`);
      loadData();
    } catch {
      alert('Failed to send reminder');
    }
  }

  const patientList = data?.allClients || data?.clientsWithTokens || [];

  const tabItems: TabItem<'medications' | 'test_push' | 'schedulers'>[] = [
    ...(medsAllowed
      ? [{ key: 'medications' as const, label: 'Prescribe Medicine & Dose Tracker', icon: <Pill /> }]
      : []),
    { key: 'test_push', label: 'Send Direct Test Push to Phone', icon: <Send /> },
    { key: 'schedulers', label: 'Automated Schedulers (Cron)', icon: <Clock /> },
  ];

  const checkboxClass = 'h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600';

  return (
    <Page>
      <PageHeader
        title="Patient Medications & Push Notifications"
        description="Prescribe 3-timing medicines, test live push notifications, and monitor patient dose intake status."
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw className={loading || loadingMeds ? 'animate-spin' : undefined} />}
            onClick={() => {
              loadAll();
            }}
            disabled={loading || loadingMeds}
          >
            Refresh
          </Button>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      {/* Top Status Cards */}
      <StatGrid columns={3}>
        <StatCard
          label="Firebase Push Service"
          value={<span className="text-lg">{data?.firebase?.projectId || 'Not Configured'}</span>}
          hint={
            <span className="flex flex-col gap-1.5">
              <span className="truncate">{data?.firebase?.clientEmail || 'Set credentials in .env to activate'}</span>
              <span>
                <StatusBadge size="sm" tone={data?.firebase?.configured ? 'success' : 'warning'} dot>
                  {data?.firebase?.configured ? 'Live Connected' : 'Mock Mode'}
                </StatusBadge>
              </span>
            </span>
          }
          icon={<Cloud />}
          tone={data?.firebase?.configured ? 'success' : 'warning'}
        />
        <StatCard
          label="Registered Mobile Devices"
          value={data?.stats?.totalRegisteredDevices ?? 0}
          hint={`${data?.stats?.patientsWithDevices ?? 0} active mobile patients`}
          icon={<Smartphone />}
          tone="brand"
        />
        <StatCard
          label="Active Prescriptions"
          value={medsAllowed ? medications.length : '—'}
          hint={medsAllowed ? 'Receiving scheduled dose reminders' : 'Medication details are hidden for your role'}
          icon={<Pill />}
          tone="brand"
        />
      </StatGrid>

      <div className="space-y-4">
        <Tabs
          label="Notification tools"
          controlsPanels={false}
          items={tabItems}
          value={activeTab}
          onChange={(key) => setActiveTab(key)}
        />

        {data && !medsAllowed && (
          <Alert tone="neutral" icon={<Pill />}>
            Medication names, doses and instructions are hidden for your role. Medication reminders appear as
            &quot;Medication reminder&quot;; prescribing and medication pushes are done by clinical staff.
          </Alert>
        )}
      </div>

      {/* TAB 1: PRESCRIBE MEDICINE & TRACK INTAKE */}
      {activeTab === 'medications' && medsAllowed && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left: Prescribe Form */}
            <Card className="lg:col-span-6">
              <CardHeader
                icon={<PlusCircle />}
                title="Prescribe Medicine to Patient"
                description="Configure clinical medication regimens with scheduled daily dose times. Regimens sync automatically to patient mobile devices with real-time push notification dispatch."
              />
              <CardBody>
                <form onSubmit={handleAssignMedicine} className="space-y-4">
                  {/* Patient Dropdown */}
                  <FormField label="Select Patient:" required>
                    <select
                      value={medPatientId}
                      onChange={(e) => setMedPatientId(e.target.value)}
                      className={inputClasses}
                      required
                    >
                      <option value="">-- Choose Patient --</option>
                      {patientList.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.deviceTokens?.length ? '(Has Mobile App)' : ''}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  {/* Medicine Name & Dosage */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField label="Medicine Name:" required>
                      <input
                        type="text"
                        value={medName}
                        onChange={(e) => setMedName(e.target.value)}
                        placeholder="Medication name"
                        className={inputClasses}
                        required
                      />
                    </FormField>
                    <FormField label="Dosage:" required>
                      <input
                        type="text"
                        value={medDosage}
                        onChange={(e) => setMedDosage(e.target.value)}
                        placeholder="Dosage"
                        className={inputClasses}
                        required
                      />
                    </FormField>
                  </div>

                  {/* Instructions */}
                  <FormField label="Instructions (How to take):">
                    <input
                      type="text"
                      value={medInstructions}
                      onChange={(e) => setMedInstructions(e.target.value)}
                      placeholder="Instructions"
                      className={inputClasses}
                    />
                  </FormField>

                  {/* Daily Timings Selection (3 Timings) */}
                  <fieldset>
                    <legend className="mb-1.5 block text-sm font-medium text-slate-700">Daily Timings:</legend>
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                        <input
                          type="checkbox"
                          checked={doseMorning}
                          onChange={(e) => setDoseMorning(e.target.checked)}
                          className={checkboxClass}
                        />
                        <span><strong className="font-semibold">Morning</strong>: 08:00 AM</span>
                      </label>

                      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                        <input
                          type="checkbox"
                          checked={doseAfternoon}
                          onChange={(e) => setDoseAfternoon(e.target.checked)}
                          className={checkboxClass}
                        />
                        <span><strong className="font-semibold">Afternoon</strong>: 01:00 PM (13:00)</span>
                      </label>

                      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                        <input
                          type="checkbox"
                          checked={doseNight}
                          onChange={(e) => setDoseNight(e.target.checked)}
                          className={checkboxClass}
                        />
                        <span><strong className="font-semibold">Night</strong>: 09:00 PM (21:00)</span>
                      </label>
                    </div>

                    {/* Optional Custom Timing */}
                    <div className="mt-2 flex items-center gap-2">
                      <label htmlFor="custom-dose-time" className="text-xs text-slate-500">Or Custom Time:</label>
                      <input
                        id="custom-dose-time"
                        type="text"
                        value={customDoseTime}
                        onChange={(e) => setCustomDoseTime(e.target.value)}
                        placeholder="HH:MM (e.g. 17:30)"
                        className={cx(inputClasses, 'w-40 py-1.5')}
                      />
                    </div>
                  </fieldset>

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    size="lg"
                    icon={<Send />}
                    loading={assigningMed}
                    className="w-full"
                  >
                    {assigningMed ? 'Prescribing & Notifying…' : 'Prescribe & Send Push to Patient Phone'}
                  </Button>
                </form>

                {assignMedResult && (
                  <Alert
                    className="mt-4"
                    tone={assignMedResult.success ? 'success' : 'danger'}
                    title={assignMedResult.success ? 'Prescription Created Successfully!' : 'Prescription Failed'}
                  >
                    {assignMedResult.notified
                      ? 'Live push notification sent to patient device.'
                      : 'Saved to database (patient has no registered phone yet).'}
                  </Alert>
                )}
              </CardBody>
            </Card>

            {/* Right: How to Test & Verify Guide */}
            <Card className="lg:col-span-6">
              <CardHeader icon={<Smartphone />} title="Patient Mobile Experience (Verification Flow)" titleAs="h3" />
              <CardBody className="space-y-3 text-xs leading-relaxed text-slate-700">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="font-semibold text-slate-800">1. Instant Push Alert on Phone:</p>
                  <p className="mt-0.5 text-slate-600">
                    Upon clinical prescription creation, an instant notification banner appears on the patient device:
                  </p>
                  <div className="mt-2 rounded-lg bg-slate-900 p-2.5 font-mono text-[11px] text-white">
                    <strong>New Prescription: [medication name]</strong><br />
                    Your doctor prescribed [medication name] ([dosage]). Timings: [dose times].
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="font-semibold text-slate-800">2. Scheduled Dose Reminders:</p>
                  <p className="mt-0.5 text-slate-600">
                    Automatic push reminders dispatch at each selected dose time to support adherence:
                  </p>
                  <div className="mt-2 rounded-lg bg-slate-900 p-2.5 font-mono text-[11px] text-white">
                    <strong>Medication Reminder: [medication name]</strong><br />
                    Time for your [dosage] dose. Instructions: [instructions].
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="font-semibold text-slate-800">3. Mobile Application Sync:</p>
                  <p className="mt-0.5 text-slate-600">
                    The patient mobile app retrieves active regimens via <code>GET /api/patient/medications</code>.
                  </p>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Active Prescriptions */}
          <Card>
            <CardHeader
              title="Active Prescribed Medications & Today's Doses"
              titleAs="h3"
              description="Live monitoring of patient dose intake status (Taken vs Pending)."
              actions={<StatusBadge tone="brand">{medications.length} Prescriptions Active</StatusBadge>}
            />

            {loadingMeds ? (
              <LoadingState label="Loading active prescriptions…" />
            ) : medications.length === 0 ? (
              <EmptyState
                icon={<Pill />}
                title="No active medication schedules yet."
                description="Prescribed regimens and today's doses appear here. Use the form above to prescribe a medicine to a patient."
              />
            ) : (
              <CardBody>
                <ul className="divide-y divide-slate-100">
                  {medications.map((med) => (
                    <li key={med.id} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">{med.medicationName}</span>
                            <StatusBadge size="sm" tone="brand">{med.dosage}</StatusBadge>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Patient: <strong className="font-semibold text-slate-800">{med.patientName}</strong> · Instructions: {med.instructions || 'As prescribed'}
                          </p>
                        </div>

                        <StatusBadge tone={med.hasMobileApp ? 'success' : 'neutral'} icon={<Smartphone />}>
                          {med.hasMobileApp ? 'Phone Connected' : 'No Phone Token'}
                        </StatusBadge>
                      </div>

                      {/* Today's Doses Breakdown */}
                      <div className="mt-3">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Today&apos;s Scheduled Doses:
                        </p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {med.todayDoses.map((dose) => (
                            <div
                              key={dose.time}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3"
                            >
                              <div>
                                <span className="flex items-center gap-1 text-xs font-semibold text-slate-900">
                                  <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden /> {dose.time}
                                </span>
                                <div className="mt-1">
                                  {dose.taken ? (
                                    <StatusBadge size="sm" tone="success" icon={<Check />}>Taken</StatusBadge>
                                  ) : (
                                    <StatusBadge size="sm" tone="warning" icon={<Clock />}>Pending</StatusBadge>
                                  )}
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                {!dose.taken && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handleMarkTaken(med.id, dose.time, med.clientId)}
                                    title="Simulate patient taking dose"
                                    className="h-10 px-2 text-xs md:h-7"
                                  >
                                    Mark Taken
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleSendInstantDoseReminder(med, dose.time)}
                                  title="Send reminder now to patient phone"
                                  className="h-10 px-2 text-xs md:h-7"
                                >
                                  Send Push
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            )}
          </Card>
        </div>
      )}

      {/* TAB 2: SEND DIRECT TEST PUSH */}
      {activeTab === 'test_push' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Form */}
          <Card className="lg:col-span-7">
            <CardHeader icon={<Send />} title="Send Direct Test Push Notification" />
            <CardBody>
              <form onSubmit={handleSendTest} className="space-y-5">
                {/* Target Selector */}
                <div>
                  <p className="mb-1.5 block text-sm font-medium text-slate-700">Recipient Target</p>
                  <Tabs
                    variant="pill"
                    label="Recipient target"
                    controlsPanels={false}
                    items={[
                      { key: 'patient', label: 'Select Patient' },
                      { key: 'token', label: 'Enter Raw FCM Token' },
                    ]}
                    value={targetMode}
                    onChange={(key) => setTargetMode(key)}
                  />
                </div>

                {targetMode === 'patient' ? (
                  <FormField label="Select Patient:">
                    <select
                      value={selectedClientId}
                      onChange={(e) => setSelectedClientId(e.target.value)}
                      className={inputClasses}
                    >
                      {patientList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} {c.deviceTokens?.length ? `(${c.deviceTokens.length} ${c.deviceTokens.length === 1 ? 'device' : 'devices'})` : '(No token yet)'}
                        </option>
                      ))}
                    </select>
                  </FormField>
                ) : (
                  <FormField label="FCM Device Registration Token:">
                    <input
                      type="text"
                      value={rawToken}
                      onChange={(e) => setRawToken(e.target.value)}
                      placeholder="Paste eX...:APA91b… from phone"
                      className={inputClasses}
                    />
                  </FormField>
                )}

                {/* Notification Type Selector */}
                <fieldset>
                  <legend className="mb-1.5 block text-sm font-medium text-slate-700">Notification Type:</legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      { id: 'medication_reminder', label: 'Medication', icon: Pill },
                      { id: 'appointment_reminder', label: 'Appointment', icon: Calendar },
                      { id: 'chat_message', label: 'Chat Reply', icon: MessageSquare },
                      { id: 'telehealth_call', label: 'Video Call', icon: Video },
                    ].filter((item) => medsAllowed || item.id !== 'medication_reminder').map((item) => {
                      const Icon = item.icon;
                      const isSelected = type === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleTypeChange(item.id)}
                          aria-pressed={isSelected}
                          className={cx(
                            'flex flex-col items-center justify-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition',
                            FOCUS_RING,
                            isSelected
                              ? 'border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600'
                              : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                          )}
                        >
                          <Icon className="h-4 w-4" aria-hidden />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <FormField label="Notification Title:" required>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Notification title"
                    className={inputClasses}
                    required
                  />
                </FormField>

                <FormField label="Notification Message:" required>
                  <textarea
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Notification message"
                    className={inputClasses}
                    required
                  />
                </FormField>

                <Button type="submit" size="lg" icon={<Send />} loading={sending} className="w-full">
                  {sending ? 'Sending to Google Firebase…' : 'Send Live Push to Phone'}
                </Button>
              </form>

              {sendResult && (
                <Alert
                  className="mt-4"
                  tone={sendResult.success ? 'success' : 'danger'}
                  title={sendResult.success ? 'Push Dispatched Successfully!' : 'Dispatch Failed / Suppressed'}
                >
                  <pre className="clinic-scroll-x mt-2 overflow-x-auto rounded-md bg-white/70 p-2 font-mono text-[11px]">
                    {JSON.stringify(sendResult, null, 2)}
                  </pre>
                </Alert>
              )}
            </CardBody>
          </Card>

          {/* Right Info */}
          <Card className="lg:col-span-5 self-start">
            <CardHeader icon={<Smartphone />} title="Mobile Device Registration" titleAs="h3" />
            <CardBody>
              <p className="text-xs leading-relaxed text-slate-500">
                When a patient authenticates on mobile, the app registers its FCM push token via:
              </p>
              <div className="clinic-scroll-x mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-slate-100">
                POST /api/patient/device-token<br />
                Body: {JSON.stringify({ token: "fcm_token…", platform: "android" }, null, 2)}
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* TAB 3: AUTOMATED SCHEDULERS (CRON) */}
      {activeTab === 'schedulers' && (
        <Card className="max-w-2xl">
          <CardHeader icon={<Clock />} title="Automated Schedulers (Cron)" />
          <CardBody>
            <p className="text-sm leading-relaxed text-slate-600">
              Reminders fire ~15 minutes before each dose time. They run on the server schedule
              (e.g. AWS EventBridge every 5 minutes) calling{' '}
              <code className="text-xs">GET /api/cron/notifications</code> with{' '}
              <code className="text-xs">Authorization: Bearer CRON_SECRET</code>. The schedulers
              cover every practice on the platform, so they cannot be started from the dashboard.
            </p>
          </CardBody>
        </Card>
      )}

      {/* Notification Logs Audit Table */}
      <Card>
        <CardHeader
          title="Recent Notification History & Audit Log"
          actions={<span className="text-xs text-slate-500 tabular-nums">{data?.recentLogs?.length || 0} entries</span>}
        />

        {loading && !data ? (
          <LoadingState rows={4} label="Loading notification history…" />
        ) : (
          <div className="clinic-scroll-x overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3">Time</th>
                  <th scope="col" className="px-4 py-3">Type</th>
                  <th scope="col" className="px-4 py-3">Title & message</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Dedupe key</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.recentLogs && data.recentLogs.length > 0 ? (
                  data.recentLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500 tabular-nums">
                        {new Date(log.sentAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge size="sm">{log.type}</StatusBadge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{log.title}</div>
                        <div className={cx('line-clamp-1 text-xs text-slate-500', log.masked && 'italic')}>{log.body}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {log.successCount > 0 ? (
                          <StatusBadge size="sm" tone="success" icon={<CheckCircle2 />}>
                            Delivered ({log.successCount})
                          </StatusBadge>
                        ) : (
                          <StatusBadge size="sm" tone="warning">Suppressed</StatusBadge>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">
                        {log.masked ? 'Hidden' : log.dedupeKey || '—'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="p-0">
                      <EmptyState
                        compact
                        icon={<Bell />}
                        title="No notifications logged yet."
                        description="Sent pushes and reminders appear here. Use the form above to send your first test."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}

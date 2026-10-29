'use client';

import { useEffect, useState } from 'react';
import {
  Bell,
  Send,
  RefreshCw,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Clock,
  Pill,
  Calendar,
  MessageSquare,
  Video,
  Play,
  PlusCircle,
  Check,
} from 'lucide-react';

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
  }>;
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
  const [title, setTitle] = useState('💊 Medication Reminder: Paracetamol');
  const [message, setMessage] = useState('Time for your 500mg dose. Take with water.');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<any>(null);

  // Prescribe Medicine Form State
  const [medPatientId, setMedPatientId] = useState('');
  const [medName, setMedName] = useState('Paracetamol');
  const [medDosage, setMedDosage] = useState('500mg');
  const [medInstructions, setMedInstructions] = useState('Take after meals with water');
  const [doseMorning, setDoseMorning] = useState(true); // 08:00
  const [doseAfternoon, setDoseAfternoon] = useState(true); // 13:00
  const [doseNight, setDoseNight] = useState(true); // 21:00
  const [customDoseTime, setCustomDoseTime] = useState('');
  const [assigningMed, setAssigningMed] = useState(false);
  const [assignMedResult, setAssignMedResult] = useState<any>(null);

  // Cron Runner State
  const [runningCron, setRunningCron] = useState(false);
  const [cronResult, setCronResult] = useState<any>(null);

  async function loadData() {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/notifications');
      if (!res.ok) throw new Error('Failed to load notification settings');
      const json = await res.json();
      setData(json);

      const defaultClient = json.clientsWithTokens?.[0]?.id || json.allClients?.[0]?.id || '';
      if (!selectedClientId && defaultClient) {
        setSelectedClientId(defaultClient);
      }
      if (!medPatientId && defaultClient) {
        setMedPatientId(defaultClient);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
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

  useEffect(() => {
    loadData();
    loadMedications();
  }, []);

  function handleTypeChange(newType: string) {
    setType(newType);
    if (newType === 'medication_reminder') {
      setTitle('💊 Medication Reminder: Metformin');
      setMessage('Time for your 500mg dose. Instructions: Take after meal.');
    } else if (newType === 'appointment_reminder') {
      setTitle('📅 Upcoming Appointment Reminder');
      setMessage('You have an appointment with Dr. Sharma at 10:30 AM.');
    } else if (newType === 'chat_message') {
      setTitle('💬 New Message from Clinician');
      setMessage('Dr. Sharma: Please remember to log your blood pressure today.');
    } else if (newType === 'telehealth_call') {
      setTitle('📹 Telehealth Session Started');
      setMessage('Dr. Sharma has joined the consultation. Tap to enter visit.');
    }
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
          title: `💊 Medication Reminder: ${med.medicationName}`,
          message: `Time for your ${med.dosage} dose (${doseTime}). Instructions: ${med.instructions || 'Take as prescribed'}.`,
        }),
      });
      const json = await res.json();
      alert(json.success ? '✅ Dose reminder push sent to patient phone!' : `⚠️ Push error: ${json.error || 'Check tokens'}`);
      loadData();
    } catch (err) {
      alert('Failed to send reminder');
    }
  }

  async function handleTriggerCron() {
    setRunningCron(true);
    setCronResult(null);
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run_cron' }),
      });
      const json = await res.json();
      setCronResult(json);
      loadData();
      loadMedications();
    } catch (err) {
      setCronResult({
        success: false,
        error: err instanceof Error ? err.message : 'Cron failed',
      });
    } finally {
      setRunningCron(false);
    }
  }

  const patientList = data?.allClients || data?.clientsWithTokens || [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100 text-[#5C2D91]">
              <Pill className="h-5 w-5" />
            </span>
            <h1 className="text-2xl font-bold text-slate-900">Patient Medications & Push Notifications</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Prescribe 3-timing medicines, test live push notifications, and monitor patient dose intake status.
          </p>
        </div>

        <button
          onClick={() => {
            loadData();
            loadMedications();
          }}
          disabled={loading || loadingMeds}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`h-4 w-4 ${loading || loadingMeds ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Top Status Cards */}
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {/* Firebase Live Status */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Firebase Push Service</span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                data?.firebase?.configured
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  data?.firebase?.configured ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
              />
              {data?.firebase?.configured ? 'Live Connected' : 'Mock Mode'}
            </span>
          </div>
          <p className="mt-3 text-lg font-bold text-slate-900">
            {data?.firebase?.projectId || 'Not Configured'}
          </p>
          <p className="mt-1 text-xs text-slate-400 truncate">
            {data?.firebase?.clientEmail || 'Set credentials in .env to activate'}
          </p>
        </div>

        {/* Registered Devices */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Registered Mobile Devices</span>
            <span className="rounded-lg bg-blue-50 p-1.5 text-blue-600">
              <Smartphone className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 text-3xl font-bold text-slate-900">
            {data?.stats?.totalRegisteredDevices ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {data?.stats?.patientsWithDevices ?? 0} active mobile patients
          </p>
        </div>

        {/* Active Prescriptions */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Active Prescriptions</span>
            <span className="rounded-lg bg-purple-50 p-1.5 text-[#5C2D91]">
              <Pill className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 text-3xl font-bold text-[#5C2D91]">
            {medications.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Receiving scheduled dose reminders
          </p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="mt-8 flex gap-2 border-b border-slate-200 pb-1">
        <button
          onClick={() => setActiveTab('medications')}
          className={`px-4 py-2 text-sm font-semibold rounded-t-xl transition-all cursor-pointer ${
            activeTab === 'medications'
              ? 'bg-[#5C2D91] text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/70'
          }`}
        >
          💊 Prescribe Medicine & Dose Tracker
        </button>
        <button
          onClick={() => setActiveTab('test_push')}
          className={`px-4 py-2 text-sm font-semibold rounded-t-xl transition-all cursor-pointer ${
            activeTab === 'test_push'
              ? 'bg-[#5C2D91] text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/70'
          }`}
        >
          📲 Send Direct Test Push to Phone
        </button>
        <button
          onClick={() => setActiveTab('schedulers')}
          className={`px-4 py-2 text-sm font-semibold rounded-t-xl transition-all cursor-pointer ${
            activeTab === 'schedulers'
              ? 'bg-[#5C2D91] text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/70'
          }`}
        >
          ⏱️ Automated Schedulers (Cron)
        </button>
      </div>

      {/* TAB 1: PRESCRIBE MEDICINE & TRACK INTAKE */}
      {activeTab === 'medications' && (
        <div className="mt-6 space-y-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            {/* Left: Prescribe Form */}
            <div className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
                <PlusCircle className="h-5 w-5 text-[#5C2D91]" />
                <h2 className="text-lg font-bold text-slate-900">Prescribe Medicine to Patient</h2>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Configure clinical medication regimens with scheduled daily dose times. Regimens sync automatically to patient mobile devices with real-time push notification dispatch.
              </p>

              <form onSubmit={handleAssignMedicine} className="mt-5 space-y-4">
                {/* Patient Dropdown */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Select Patient:
                  </label>
                  <select
                    value={medPatientId}
                    onChange={(e) => setMedPatientId(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-purple-600 focus:outline-none"
                    required
                  >
                    <option value="">-- Choose Patient --</option>
                    {patientList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.deviceTokens?.length ? '📱 (Has Mobile App)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Medicine Name & Dosage */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Medicine Name:
                    </label>
                    <input
                      type="text"
                      value={medName}
                      onChange={(e) => setMedName(e.target.value)}
                      placeholder="e.g. Paracetamol"
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 shadow-sm focus:border-purple-600 focus:outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Dosage:
                    </label>
                    <input
                      type="text"
                      value={medDosage}
                      onChange={(e) => setMedDosage(e.target.value)}
                      placeholder="e.g. 500mg, 1 tablet"
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 shadow-sm focus:border-purple-600 focus:outline-none"
                      required
                    />
                  </div>
                </div>

                {/* Instructions */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Instructions (How to take):
                  </label>
                  <input
                    type="text"
                    value={medInstructions}
                    onChange={(e) => setMedInstructions(e.target.value)}
                    placeholder="e.g. Khane ke baad (Take after meals)"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 shadow-sm focus:border-purple-600 focus:outline-none"
                  />
                </div>

                {/* Daily Timings Selection (3 Timings) */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    Daily Timings (Din me kab-kab leni hai):
                  </label>
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={doseMorning}
                        onChange={(e) => setDoseMorning(e.target.checked)}
                        className="rounded border-slate-300 text-purple-600 focus:ring-purple-500 h-4 w-4"
                      />
                      <span>🌅 <strong>Morning</strong>: 08:00 AM</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={doseAfternoon}
                        onChange={(e) => setDoseAfternoon(e.target.checked)}
                        className="rounded border-slate-300 text-purple-600 focus:ring-purple-500 h-4 w-4"
                      />
                      <span>☀️ <strong>Afternoon</strong>: 01:00 PM (13:00)</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={doseNight}
                        onChange={(e) => setDoseNight(e.target.checked)}
                        className="rounded border-slate-300 text-purple-600 focus:ring-purple-500 h-4 w-4"
                      />
                      <span>🌙 <strong>Night</strong>: 09:00 PM (21:00)</span>
                    </label>
                  </div>

                  {/* Optional Custom Timing */}
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-slate-500">Or Custom Time:</span>
                    <input
                      type="text"
                      value={customDoseTime}
                      onChange={(e) => setCustomDoseTime(e.target.value)}
                      placeholder="HH:MM (e.g. 17:30)"
                      className="w-32 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-900"
                    />
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={assigningMed}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#5C2D91] py-3 text-sm font-semibold text-white shadow hover:bg-[#4A2475] disabled:opacity-50 cursor-pointer transition"
                >
                  {assigningMed ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Prescribing & Notifying...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Prescribe & Send Push to Patient Phone
                    </>
                  )}
                </button>
              </form>

              {assignMedResult && (
                <div
                  className={`mt-4 rounded-xl border p-4 text-xs ${
                    assignMedResult.success
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-red-200 bg-red-50 text-red-800'
                  }`}
                >
                  <p className="font-bold flex items-center gap-1.5">
                    {assignMedResult.success ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        Prescription Created Successfully!
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-4 w-4 text-red-600" />
                        Prescription Failed
                      </>
                    )}
                  </p>
                  <p className="mt-1">
                    {assignMedResult.notified
                      ? '📲 Live Push Notification sent to patient device!'
                      : 'ℹ️ Saved to database (Patient has no registered phone yet).'}
                  </p>
                </div>
              )}
            </div>

            {/* Right: How to Test & Verify Guide */}
            <div className="lg:col-span-6 space-y-4">
              <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-5">
                <h3 className="text-sm font-bold text-purple-900 flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-[#5C2D91]" />
                  Patient Mobile Experience (Verification Flow)
                </h3>
                <div className="mt-3 space-y-3 text-xs text-purple-950 leading-relaxed">
                  <div className="bg-white/80 p-3 rounded-xl border border-purple-100">
                    <p className="font-bold text-slate-800">1. Instant Push Alert on Phone:</p>
                    <p className="text-slate-600 mt-0.5">
                      Upon clinical prescription creation, an instant notification banner appears on the patient device:
                    </p>
                    <div className="mt-2 rounded-lg bg-slate-900 text-white p-2.5 font-mono text-[11px]">
                      <strong>💊 New Prescription: Paracetamol</strong><br />
                      Your doctor prescribed Paracetamol (500mg). Timings: 08:00, 13:00, 21:00.
                    </div>
                  </div>

                  <div className="bg-white/80 p-3 rounded-xl border border-purple-100">
                    <p className="font-bold text-slate-800">2. Scheduled Dose Reminders:</p>
                    <p className="text-slate-600 mt-0.5">
                      Automatic push reminders dispatch at 08:00, 13:00, and 21:00 to ensure adherence:
                    </p>
                    <div className="mt-2 rounded-lg bg-slate-900 text-white p-2.5 font-mono text-[11px]">
                      <strong>💊 Medication Reminder: Paracetamol</strong><br />
                      Time for your 500mg dose. Instructions: Take after meals.
                    </div>
                  </div>

                  <div className="bg-white/80 p-3 rounded-xl border border-purple-100">
                    <p className="font-bold text-slate-800">3. Mobile Application Sync:</p>
                    <p className="text-slate-600 mt-0.5">
                      The patient mobile app retrieves active regimens via <code>GET /api/patient/medications</code>.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Active Prescriptions Table */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Active Prescribed Medications & Today's Doses</h3>
                <p className="text-xs text-slate-500">Live monitoring of patient dose intake status (Taken vs Pending).</p>
              </div>
              <span className="text-xs font-semibold bg-purple-50 text-[#5C2D91] px-3 py-1 rounded-full border border-purple-100">
                {medications.length} Prescriptions Active
              </span>
            </div>

            {loadingMeds ? (
              <div className="py-8 text-center text-xs text-slate-500">Loading active prescriptions...</div>
            ) : medications.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                No active medication schedules yet. Use the form above to prescribe a medicine to a patient!
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {medications.map((med) => (
                  <div key={med.id} className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200/60 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{med.medicationName}</span>
                          <span className="rounded-md bg-purple-100 px-2 py-0.5 text-xs font-semibold text-[#5C2D91]">
                            {med.dosage}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Patient: <strong className="text-slate-800">{med.patientName}</strong> · Instructions: {med.instructions || 'As prescribed'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          med.hasMobileApp ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'
                        }`}>
                          <Smartphone className="h-3 w-3" />
                          {med.hasMobileApp ? 'Phone Connected' : 'No Phone Token'}
                        </span>
                      </div>
                    </div>

                    {/* Today's Doses Breakdown */}
                    <div className="mt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                        Today's Scheduled Doses:
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {med.todayDoses.map((dose) => (
                          <div
                            key={dose.time}
                            className={`flex items-center justify-between p-3 rounded-xl border ${
                              dose.taken
                                ? 'bg-emerald-50 border-emerald-200'
                                : 'bg-white border-slate-200'
                            }`}
                          >
                            <div>
                              <span className="font-bold text-slate-900 text-xs">
                                ⏰ {dose.time}
                              </span>
                              <div className="text-[11px] mt-0.5">
                                {dose.taken ? (
                                  <span className="text-emerald-700 font-semibold flex items-center gap-1">
                                    <Check className="h-3 w-3" /> Taken
                                  </span>
                                ) : (
                                  <span className="text-amber-600 font-semibold">
                                    ⏳ Pending
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {!dose.taken && (
                                <button
                                  type="button"
                                  onClick={() => handleMarkTaken(med.id, dose.time, med.clientId)}
                                  className="text-[10px] font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-2 py-1 rounded-lg cursor-pointer transition"
                                  title="Simulate patient taking dose"
                                >
                                  Mark Taken
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleSendInstantDoseReminder(med, dose.time)}
                                className="text-[10px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 px-2 py-1 rounded-lg cursor-pointer transition"
                                title="Send reminder now to patient phone"
                              >
                                Send Push
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: SEND DIRECT TEST PUSH */}
      {activeTab === 'test_push' && (
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left Form */}
          <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
              <Send className="h-5 w-5 text-[#5C2D91]" />
              <h2 className="text-lg font-bold text-slate-900">Send Direct Test Push Notification</h2>
            </div>

            <form onSubmit={handleSendTest} className="mt-5 space-y-5">
              {/* Target Selector Tabs */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Recipient Target
                </label>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setTargetMode('patient')}
                    className={`rounded-lg py-2 text-xs font-semibold transition cursor-pointer ${
                      targetMode === 'patient'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Select Patient
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetMode('token')}
                    className={`rounded-lg py-2 text-xs font-semibold transition cursor-pointer ${
                      targetMode === 'token'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Enter Raw FCM Token
                  </button>
                </div>
              </div>

              {targetMode === 'patient' ? (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Select Patient:
                  </label>
                  <select
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-purple-600 focus:outline-none"
                  >
                    {patientList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.deviceTokens?.length ? `📱 (${c.deviceTokens.length} device)` : '(No token yet)'}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    FCM Device Registration Token:
                  </label>
                  <input
                    type="text"
                    value={rawToken}
                    onChange={(e) => setRawToken(e.target.value)}
                    placeholder="Paste eX...:APA91b... from phone"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-purple-600 focus:outline-none"
                  />
                </div>
              )}

              {/* Notification Type Selector */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Notification Type:
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { id: 'medication_reminder', label: 'Medication', icon: Pill },
                    { id: 'appointment_reminder', label: 'Appointment', icon: Calendar },
                    { id: 'chat_message', label: 'Chat Reply', icon: MessageSquare },
                    { id: 'telehealth_call', label: 'Video Call', icon: Video },
                  ].map((item) => {
                    const Icon = item.icon;
                    const isSelected = type === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleTypeChange(item.id)}
                        className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition cursor-pointer ${
                          isSelected
                            ? 'border-[#5C2D91] bg-purple-50/50 text-[#5C2D91] ring-1 ring-[#5C2D91]'
                            : 'border-slate-200 hover:border-slate-300 text-slate-700'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Notification Title:</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 shadow-sm focus:border-purple-600 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Notification Message:</label>
                <textarea
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 shadow-sm focus:border-purple-600 focus:outline-none"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={sending}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#5C2D91] py-3 text-sm font-semibold text-white shadow hover:bg-[#4A2475] disabled:opacity-50 cursor-pointer transition"
              >
                {sending ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Sending to Google Firebase...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Send Live Push to Phone
                  </>
                )}
              </button>
            </form>

            {sendResult && (
              <div
                className={`mt-4 rounded-xl border p-4 text-xs ${
                  sendResult.success
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                <div className="font-semibold flex items-center gap-1.5">
                  {sendResult.success ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-red-600" />
                  )}
                  {sendResult.success ? 'Push Dispatched Successfully!' : 'Dispatch Failed / Suppressed'}
                </div>
                <pre className="mt-2 overflow-x-auto rounded bg-white/60 p-2 font-mono text-[11px]">
                  {JSON.stringify(sendResult, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* Right Info */}
          <div className="lg:col-span-5 space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-bold text-slate-800">Mobile Device Registration</h3>
              <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                When a patient authenticates on mobile, the app registers its FCM push token via:
              </p>
              <div className="mt-3 bg-slate-900 text-slate-100 p-3 rounded-xl font-mono text-[11px] overflow-x-auto">
                POST /api/patient/device-token<br />
                Body: {JSON.stringify({ token: "fcm_token...", platform: "android" }, null, 2)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: AUTOMATED SCHEDULERS (CRON) */}
      {activeTab === 'schedulers' && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm max-w-2xl">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
            <Clock className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-900">Trigger Automated Schedulers (Cron)</h2>
          </div>
          <p className="mt-3 text-xs text-slate-500 leading-relaxed">
            Reminders fire ~15 minutes before each dose time. Production needs an external cron
            (e.g. AWS EventBridge every 5 minutes) calling{' '}
            <code className="text-xs">GET /api/cron/notifications</code> with{' '}
            <code className="text-xs">Authorization: Bearer CRON_SECRET</code>. Use the button
            below to run the same checks now from the dashboard.
          </p>

          <button
            onClick={handleTriggerCron}
            disabled={runningCron}
            className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-blue-600 bg-blue-50 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 cursor-pointer transition"
          >
            {runningCron ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Running Schedulers...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Run Schedulers (Cron) Now
              </>
            )}
          </button>

          {cronResult && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/50 p-4 text-xs text-blue-900">
              <p className="font-semibold">Cron Execution Results:</p>
              <pre className="mt-2 overflow-x-auto rounded bg-white p-2.5 font-mono text-[11px]">
                {JSON.stringify(cronResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Notification Logs Audit Table */}
      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h2 className="text-lg font-bold text-slate-900">Recent Notification History & Audit Log</h2>
          <span className="text-xs text-slate-500 font-mono">
            {data?.recentLogs?.length || 0} entries
          </span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Title & Message</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Dedupe Key</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-normal">
              {data?.recentLogs && data.recentLogs.length > 0 ? (
                data.recentLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                      {new Date(log.sentAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-800 text-[11px]">
                        {log.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{log.title}</div>
                      <div className="text-slate-500 line-clamp-1">{log.body}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {log.successCount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" />
                          Delivered ({log.successCount})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          Suppressed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-slate-400">
                      {log.dedupeKey || '—'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No notifications logged yet. Use the form above to send your first test!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

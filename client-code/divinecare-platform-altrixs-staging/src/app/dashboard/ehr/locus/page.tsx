'use client';

import { useEffect, useMemo, useState } from 'react';
import { 
  AlertTriangle, 
  BarChart2, 
  CheckCircle2, 
  Clock, 
  Compass, 
  FileText, 
  Info, 
  Plus, 
  ShieldAlert, 
  Sparkles, 
  User, 
  X 
} from 'lucide-react';
import { useClients } from '@/features/clients';
import { apiJson } from '@/lib/api-client';
import { 
  LOCUS_DIMENSIONS, 
  calculateLocusLevelOfCare 
} from '@/features/ehr/locus/locusCatalog';
import { PageHeader, buttonClasses, Alert } from '@/components/ui';

interface LocusRecord {
  id: string;
  clientId: string;
  assessmentType: string;
  dimensionScores: Record<string, number>;
  compositeScore: number;
  recommendedLevel: string;
  recommendedLevelName: string;
  overrideLevel?: string;
  overrideRationale?: string;
  assessedBy: string;
  createdAt: string;
}

export default function LocusAssessmentPage() {
  const { clients } = useClients();
  const [error, setError] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [assessmentType, setAssessmentType] = useState<'LOCUS' | 'CALOCUS'>('LOCUS');

  // History State
  const [records, setRecords] = useState<LocusRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Active Assessment Form State
  const [scores, setScores] = useState<Record<string, number>>({
    dim1_harm: 1,
    dim2_function: 1,
    dim3_comorbidity: 1,
    dim4a_stress: 1,
    dim4b_support: 1,
    dim5_history: 1,
    dim6_engagement: 1,
  });

  // Clinician Override State
  const [overrideLevel, setOverrideLevel] = useState('');
  const [overrideRationale, setOverrideRationale] = useState('');

  // View Record Drawer
  const [viewRecord, setViewRecord] = useState<LocusRecord | null>(null);

  // Client from the link (?clientId=, e.g. the Visit Guide), else the first client
  useEffect(() => {
    if (clients.length > 0 && !selectedClientId) {
      const wanted = new URLSearchParams(window.location.search).get('clientId');
      setSelectedClientId(wanted && clients.some((c) => c.id === wanted) ? wanted : clients[0].id);
    }
  }, [clients, selectedClientId]);

  // Load history records
  const loadRecords = async () => {
    setLoading(true);
    try {
      const url = selectedClientId 
        ? `/api/clinical/locus?clientId=${selectedClientId}`
        : '/api/clinical/locus';
      const res = await apiJson<{ success: boolean; data: LocusRecord[] }>(url);
      if (res.success && res.data) {
        setRecords(res.data);
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load records'); } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, [selectedClientId]);

  // Live Composite Score & Level of Care
  const compositeScore = useMemo(() => {
    return Object.values(scores).reduce((sum, val) => sum + (Number(val) || 1), 0);
  }, [scores]);

  const recommendedResult = useMemo(() => {
    return calculateLocusLevelOfCare(compositeScore);
  }, [compositeScore]);

  const handleSubmit = async () => {
    if (!selectedClientId) return;
    setSubmitting(true);
    try {
      const payload = {
        clientId: selectedClientId,
        assessmentType: assessmentType,
        scores: scores,
        overrideLevel: overrideLevel || undefined,
        overrideRationale: overrideRationale || undefined,
      };

      await apiJson('/api/clinical/locus', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // Reset override inputs
      setOverrideLevel('');
      setOverrideRationale('');
      loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      {/* Top Header */}
      <PageHeader
        title="LOCUS / CALOCUS Assessment"
        description={<>Level of Care Utilization System for Adults (LOCUS) & Children/Adolescents (CALOCUS).</>}
        actions={<>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <User size={16} className="text-slate-500" />
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="bg-transparent text-sm font-medium text-slate-800 focus:outline-none"
            >
              <option value="" disabled>Select Patient…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id.slice(0, 6)})
                </option>
              ))}
            </select>
          </div>

          <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            {(['LOCUS', 'CALOCUS'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setAssessmentType(type)}
                className={`px-4 py-2 rounded-lg transition-all ${
                  assessmentType === type
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {type === 'LOCUS' ? 'Adult (LOCUS)' : 'Youth (CALOCUS)'}
              </button>
            ))}
          </div>
        </div>
        </>}
      />

      {/* Main Grid: Form Left, Real-Time Recommendation Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: 6 Core Dimension Rating Selectors */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-xs space-y-6">
            <h2 className="text-base font-bold text-slate-900 border-b pb-3 flex items-center justify-between">
              <span>{assessmentType} Core Dimension Ratings</span>
              <span className="text-xs text-slate-500 font-normal">Score Range: 1 (Mild) to 5 (Extreme)</span>
            </h2>

            {LOCUS_DIMENSIONS.map((dim) => (
              <div key={dim.id} className="p-4 bg-slate-50/70 rounded-xl border border-slate-200/80 space-y-3">
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-800">{dim.name}</h3>
                    <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                      Score: {scores[dim.id] || 1}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{dim.description}</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                  {dim.options.map((opt) => {
                    const isSelected = scores[dim.id] === opt.score;
                    return (
                      <button
                        key={opt.score}
                        type="button"
                        onClick={() => setScores((prev) => ({ ...prev, [dim.id]: opt.score }))}
                        className={`p-3.5 rounded-xl border text-xs font-bold text-left transition-all flex flex-col justify-between space-y-2 ${
                          isSelected
                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'
                        }`}
                      >
                        <div>{opt.label}</div>
                        <div className={`text-[11px] font-normal leading-relaxed ${isSelected ? 'text-blue-200' : 'text-slate-500'}`}>
                          {opt.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Composite Score Card & Override Panel */}
        <div className="space-y-4">
          {/* Live Level of Care Output */}
          <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-xs space-y-4 sticky top-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Calculated Level of Care (LOC)
            </h3>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-center space-y-2">
              <span className="text-xs font-bold uppercase text-blue-900">Composite Score</span>
              <div className="text-4xl font-semibold text-blue-600">{compositeScore}</div>
              <div className="text-xs text-blue-700 font-semibold">Maximum Score: 35</div>
            </div>

            <div className="p-4 bg-slate-900 text-white rounded-xl space-y-1">
              <span className="text-[11px] uppercase font-bold text-blue-300 tracking-wider">
                Recommended Placement
              </span>
              <h4 className="text-lg font-bold text-white">{recommendedResult.level}</h4>
              <p className="text-xs text-slate-500 font-medium">{recommendedResult.name}</p>
            </div>

            {/* Clinician Override Section */}
            <div className="pt-3 border-t border-slate-200 space-y-3">
              <h4 className="text-xs font-bold text-slate-800 uppercase">Clinician Level Override (Optional)</h4>

              <select
                value={overrideLevel}
                onChange={(e) => setOverrideLevel(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
              >
                <option value="">No Override (Use Recommended)</option>
                <option value="Level 1">Level 1: Low Intensity Outpatient</option>
                <option value="Level 2">Level 2: Low Intensity Community-Based</option>
                <option value="Level 3">Level 3: High Intensity IOP</option>
                <option value="Level 4">Level 4: PHP / Non-Residential</option>
                <option value="Level 5">Level 5: Medically Monitored Residential</option>
                <option value="Level 6">Level 6: Medically Managed Inpatient</option>
              </select>

              {overrideLevel && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-amber-700">Override Clinical Rationale *</label>
                  <textarea
                    rows={2}
                    value={overrideRationale}
                    onChange={(e) => setOverrideRationale(e.target.value)}
                    placeholder="Document clinical justification for level of care override…"
                    className="w-full p-2.5 bg-white border border-amber-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              )}
            </div>

            <button
              disabled={submitting || !selectedClientId}
              onClick={handleSubmit}
              className={buttonClasses({ variant: 'primary', size: 'sm', className: 'w-full' })}
            >
              {submitting ? 'Saving Assessment…' : `Save ${assessmentType} Assessment`}
            </button>
          </div>

          {/* Historical LOCUS Assessments */}
          <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Historical LOCUS Scores</h3>
            {loading ? (
              <p className="text-xs text-slate-500">Loading history…</p>
            ) : records.length === 0 ? (
              <p className="text-xs text-slate-500">No past LOCUS assessments on record.</p>
            ) : (
              <div className="space-y-2">
                {records.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => setViewRecord(r)}
                    className="p-3 bg-slate-50 hover:bg-blue-50 rounded-xl border border-slate-200/80 cursor-pointer transition-colors flex items-center justify-between"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-900">
                        {r.overrideLevel || r.recommendedLevel} ({r.compositeScore})
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {new Date(r.createdAt).toLocaleDateString()} · {r.assessmentType}
                      </div>
                    </div>
                    <span className="text-xs font-bold text-blue-600">View</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* VIEW RECORD DRAWER */}
      {viewRecord && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-end">
          <div className="bg-white w-full max-w-md h-full p-6 shadow-xs overflow-y-auto space-y-6">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <span className="text-[11px] uppercase font-semibold bg-blue-100 text-blue-600 px-2 py-0.5 rounded">
                  LOCUS Result Detail
                </span>
                <h3 className="text-lg font-bold text-slate-900 mt-1">{viewRecord.recommendedLevel}</h3>
              </div>
              <button onClick={() => setViewRecord(null)} className="text-slate-500 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Composite Score:</span>
                  <span className="font-semibold text-blue-600 text-base">{viewRecord.compositeScore}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Recommended Placement:</span>
                  <span className="font-bold text-slate-800">{viewRecord.recommendedLevelName}</span>
                </div>
                {viewRecord.overrideLevel && (
                  <div className="p-2.5 bg-amber-100 text-amber-900 rounded-lg text-xs font-bold">
                    Clinician Override: {viewRecord.overrideLevel}
                  </div>
                )}
              </div>

              {viewRecord.overrideRationale && (
                <div>
                  <h4 className="font-bold text-amber-800 uppercase text-[11px]">Override Rationale</h4>
                  <Alert tone="warning" className="mt-1">
                    {viewRecord.overrideRationale}
                  </Alert>
                </div>
              )}

              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-2">Dimension Scores Breakdown</h4>
                <div className="space-y-1.5">
                  {Object.entries(viewRecord.dimensionScores).map(([dimId, val]) => (
                    <div key={dimId} className="flex justify-between bg-slate-50 px-3 py-2 rounded-lg">
                      <span className="font-bold text-slate-700">{dimId.replace('dim', 'Dimension ')}:</span>
                      <span className="font-semibold text-blue-600">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200">
              <button
                onClick={() => setViewRecord(null)}
                className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800"
              >
                Close Detail
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

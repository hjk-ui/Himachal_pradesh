'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  FileText,
  Search,
  Activity,
  Pill,
  CheckCircle2,
  Copy,
  Check,
  Cpu,
  Brain,
  Layers,
  ArrowRight,
} from 'lucide-react';
import MedicalNavHeader from '@/features/medical/components/MedicalNavHeader';
import { buttonClasses } from '@/components/ui';

export default function MedicalAIPage() {
  const [activeModule, setActiveModule] = useState<'Documentation' | 'Comprehend' | 'Population' | 'Interactions'>('Documentation');
  const [copied, setCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);

  // Module 1: Documentation State
  const [docVisitType, setDocVisitType] = useState('HTN Follow-up');
  const [docChiefComplaint, setDocChiefComplaint] = useState('');
  const [docOutput, setDocOutput] = useState('');

  // Module 2: Comprehend NLP State
  const [nlpInput, setNlpInput] = useState('');
  const [nlpEntities, setNlpEntities] = useState<{ text: string; category: string; standardCode: string; score: number | null }[]>([]);
  const [docError, setDocError] = useState<string | null>(null);
  const [nlpError, setNlpError] = useState<string | null>(null);

  const handleGenerateDoc = async () => {
    setIsGenerating(true);
    setDocError(null);
    try {
      const res = await fetch('/api/medical/ai/bedrock-soap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawNote: docChiefComplaint,
          visitType: docVisitType,
          patientName: 'Established Clinic Patient',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.soap) {
        const formatted = `SUBJECTIVE:\n${data.soap.subjective}\n\nOBJECTIVE:\n${data.soap.objective}\n\nASSESSMENT:\n${data.soap.assessment}\n\nPLAN:\n${data.soap.plan}\n\nRECOMMENDED E&M CODES:\n${data.suggestedCpt?.map((c: any) => `- CPT ${c.code} (${c.description})${c.modifier ? ` [Modifier -${c.modifier}]` : ''}`).join('\n') || '- None suggested'}\n\nICD-10 SUGGESTIONS:\n${data.suggestedIcd10?.map((i: any) => `- ${i.code}: ${i.description}`).join('\n') || '- None suggested'}`;
        setDocOutput(formatted);
      } else {
        // No template stand-in: the clinician sees that drafting did not run
        setDocOutput('');
        setDocError(data.error || `SOAP drafting is not available (${res.status}). Write the note in the SOAP builder.`);
      }
    } catch {
      setDocOutput('');
      setDocError('Could not reach SOAP drafting. Write the note in the SOAP builder.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExtractEntities = async () => {
    setIsExtracting(true);
    setNlpError(null);
    try {
      const res = await fetch('/api/medical/ai/comprehend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: nlpInput }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.entities)) {
        setNlpEntities(
          data.entities.map((e: any) => ({
            text: e.text,
            category: e.category === 'MEDICAL_CONDITION' ? 'Medical Condition' : e.category === 'MEDICATION' ? 'Medication' : e.category || 'Other',
            // Only codes Comprehend returned; nothing is labeled with an ontology it did not map to
            standardCode: e.icd10 ? `ICD-10: ${e.icd10}` : e.rxNorm ? `RxNorm: ${e.rxNorm}` : 'No code',
            score: typeof e.confidence === 'number' ? e.confidence : null,
          }))
        );
      } else {
        setNlpEntities([]);
        setNlpError(data.error || `Entity extraction is not available (${res.status}).`);
      }
    } catch {
      setNlpEntities([]);
      setNlpError('Could not reach Comprehend Medical.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 pb-16">
      <MedicalNavHeader
        title="Medical AI Clinical Intelligence Suite"
        subtitle="Bedrock SOAP note generation, AWS Comprehend Medical NLP, HEDIS quality metrics, and interaction checking"
        badge="HIPAA BAA & Bedrock Medical Secured"
      />

      <div className="min-w-0">
        {/* Module Switcher Tabs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { id: 'Documentation', label: '1. SOAP Note Generator', desc: 'Bedrock Clinical LLM', icon: FileText },
            { id: 'Comprehend', label: '2. NLP Entity Extraction', desc: 'Comprehend Medical', icon: Brain },
            { id: 'Population', label: '3. Population & HEDIS', desc: 'MIPS Quality Analytics', icon: Activity },
            { id: 'Interactions', label: '4. Interaction Checker', desc: 'Not available yet', icon: Pill },
          ].map((m) => {
            const Icon = m.icon;
            const isSelected = activeModule === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setActiveModule(m.id as any)}
                className={`p-4 rounded-xl border text-left transition shadow-xs flex flex-col justify-between ${
                  isSelected
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs ring-2 ring-blue-300'
                    : 'bg-white text-slate-800 border-slate-200 hover:border-blue-200'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <Icon className={`w-5 h-5 ${isSelected ? 'text-white' : 'text-blue-600'}`} />
                  {isSelected && <Sparkles className="w-4 h-4 text-blue-200 animate-spin" />}
                </div>
                <div>
                  <div className="text-xs font-semibold">{m.label}</div>
                  <div className={`text-[11px] ${isSelected ? 'text-blue-100' : 'text-slate-500'}`}>
                    {m.desc}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* MODULE 1: Bedrock SOAP Note Generator */}
        {activeModule === 'Documentation' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="min-w-0 lg:col-span-5 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
                <Sparkles className="w-4 h-4 text-blue-600" />
                <h3 className="font-semibold text-sm text-slate-900">Encounter Input Parameters</h3>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Encounter Type
                </label>
                <select
                  value={docVisitType}
                  onChange={(e) => setDocVisitType(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  <option value="HTN Follow-up">HTN Follow-up</option>
                  <option value="Diabetes Management">Diabetes Management</option>
                  <option value="Annual Physical">Annual Physical Exam</option>
                  <option value="Acute Visit">Acute Respiratory / Infection</option>
                  <option value="Well-Woman">Well-Woman Preventive Exam</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Chief Complaint / Dictated Clinical Findings
                </label>
                <textarea
                  rows={6}
                  value={docChiefComplaint}
                  onChange={(e) => setDocChiefComplaint(e.target.value)}
                  placeholder="Enter the chief complaint and dictated clinical findings for this encounter…"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs leading-relaxed focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <button
                onClick={handleGenerateDoc}
                disabled={isGenerating}
                className={buttonClasses({ size: 'sm', className: 'w-full' })}
              >
                <Sparkles className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                {isGenerating ? 'Generating Bedrock SOAP Note…' : 'Generate Structured SOAP Note'}
              </button>
            </div>

            <div className="min-w-0 lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-600" />
                  <span className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                    Generated Bedrock Medical SOAP Note
                  </span>
                </div>
                <button
                  onClick={() => handleCopyText(docOutput)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold transition"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy SOAP'}
                </button>
              </div>

              <div className="p-5 flex-1 overflow-y-auto">
                {docError ? (
                  <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {docError}
                  </p>
                ) : null}
                {docOutput ? (
                  <pre className="font-mono text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                    {docOutput}
                  </pre>
                ) : (
                  <p className="py-10 text-center text-xs text-slate-500">
                    No SOAP note generated yet. Enter encounter findings and click Generate.
                  </p>
                )}
              </div>

              <div className="p-3 bg-blue-50/60 border-t border-blue-100 flex items-center justify-between text-xs text-blue-900">
                <span>Evaluated against 2023 AMA E&amp;M Medical Decision Making guidelines</span>
                <Link
                  href="/dashboard/medical/visits"
                  className="font-semibold text-blue-700 hover:text-blue-900 flex items-center gap-1"
                >
                  Open in SOAP Builder &rarr;
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* MODULE 2: AWS Comprehend Medical NLP */}
        {activeModule === 'Comprehend' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm text-slate-900">Unstructured Clinical Narrative Input</h3>
                <button
                  onClick={handleExtractEntities}
                  disabled={isExtracting}
                  className={buttonClasses({ size: 'sm' })}
                >
                  <Brain className={`w-3.5 h-3.5 ${isExtracting ? 'animate-spin' : ''}`} />
                  {isExtracting ? 'Extracting…' : 'Run Comprehend Medical NLP'}
                </button>
              </div>
              <textarea
                rows={3}
                value={nlpInput}
                onChange={(e) => setNlpInput(e.target.value)}
                placeholder="Paste an unstructured clinical narrative to extract conditions, medications, and allergies…"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs leading-relaxed focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-4 py-4 sm:px-6 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-slate-900 text-sm">Extracted Named Entities &amp; Ontologies</h3>
                  <p className="text-xs text-slate-500">ICD-10-CM and RxNorm codes returned by Comprehend Medical</p>
                  {nlpError ? <p role="alert" className="mt-1 text-xs text-rose-600">{nlpError}</p> : null}
                </div>
                <span className="text-xs font-mono bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded">
                  {nlpEntities.length} Entities Extracted
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600 uppercase">
                      <th scope="col" className="py-2.5 px-4">Entity Text</th>
                      <th scope="col" className="py-2.5 px-4">Category</th>
                      <th scope="col" className="py-2.5 px-4">Standardized Code</th>
                      <th scope="col" className="py-2.5 px-4">Confidence Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {nlpEntities.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 px-4 text-center text-slate-500">
                          No entities extracted yet.
                        </td>
                      </tr>
                    )}
                    {nlpEntities.map((ent, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-semibold text-slate-900">{ent.text}</td>
                        <td className="py-3 px-4">
                          <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium">
                            {ent.category}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-blue-700 font-semibold">{ent.standardCode}</td>
                        <td className="py-3 px-4">
                          {ent.score == null ? (
                            <span className="font-mono text-[11px] text-slate-500">—</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-slate-200 rounded-full h-1.5">
                                <div
                                  className="bg-emerald-600 h-1.5 rounded-full"
                                  style={{ width: `${ent.score * 100}%` }}
                                />
                              </div>
                              <span className="font-mono text-[11px] text-slate-600">{(ent.score * 100).toFixed(0)}%</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* MODULE 3: Population Health & HEDIS */}
        {activeModule === 'Population' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  <span>HEDIS HbA1c Poor Control (&gt;9%)</span>
                  <span className="text-slate-500 font-semibold">No Data</span>
                </div>
                <div className="text-2xl font-semibold text-slate-900 mt-2">— <span className="text-xs font-normal text-slate-500">of diabetic panel</span></div>
                <div className="mt-2 text-xs text-slate-600">Benchmark: &lt;15% (Lower is better).</div>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  <span>Controlling High Blood Pressure</span>
                  <span className="text-slate-500 font-semibold">No Data</span>
                </div>
                <div className="text-2xl font-semibold text-slate-900 mt-2">— <span className="text-xs font-normal text-slate-500">in target (&lt;140/90)</span></div>
                <div className="mt-2 text-xs text-slate-600">NCQA 75th percentile benchmark: &ge;72.5%.</div>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  <span>Colorectal Cancer Screening</span>
                  <span className="text-slate-500 font-semibold">No Data</span>
                </div>
                <div className="text-2xl font-semibold text-slate-900 mt-2">— <span className="text-xs font-normal text-slate-500">compliant</span></div>
                <div className="mt-2 text-xs text-slate-600">Target: &ge;75%.</div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
              <h3 className="font-semibold text-slate-900 text-sm mb-3">Chronic Disease Panel Prevalence</h3>
              <p className="py-6 text-center text-xs text-slate-500">
                No medical panel data yet. Prevalence will populate as patient problem lists are documented.
              </p>
            </div>
          </div>
        )}

        {/* MODULE 4: Interaction Checker — no interaction database is connected */}
        {activeModule === 'Interactions' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs text-sm text-slate-600">
            <h3 className="font-semibold text-slate-900 mb-1">Interaction Checker — not available yet</h3>
            <p className="text-xs leading-relaxed">
              No drug-interaction database is connected here, so no check is run and no result is shown. Use DrFirst
              (E-Prescribe), which screens drug-drug and drug-allergy interactions when prescribing.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

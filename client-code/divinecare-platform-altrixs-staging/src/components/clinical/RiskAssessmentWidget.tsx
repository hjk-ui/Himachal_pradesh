'use client';

export type RiskAssessmentValue = {
  suicidalIdeation: 'Denied' | 'Passive' | 'Active without Plan' | 'Active with Plan/Intent';
  ideationDetails: string;
  accessToMeans: 'No' | 'Yes' | 'Unknown';
  meansDetails: string;
  priorAttempts: 'None' | '1 Attempt' | 'Multiple Attempts';
  priorAttemptDetails: string;
  nonSuicidalSelfInjury: 'Denied' | 'Past History' | 'Recent/Active';
  homicidalIdeation: 'Denied' | 'Present without Plan' | 'Present with Plan/Intent';
  homicidalDetails: string;
  overallRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'SEVERE';
  clinicalRationale: string;
  safetyActionsTaken: string[];
};

export const DEFAULT_RISK_VALUE: RiskAssessmentValue = {
  suicidalIdeation: 'Denied',
  ideationDetails: '',
  accessToMeans: 'No',
  meansDetails: '',
  priorAttempts: 'None',
  priorAttemptDetails: '',
  nonSuicidalSelfInjury: 'Denied',
  homicidalIdeation: 'Denied',
  homicidalDetails: '',
  overallRiskLevel: 'LOW',
  clinicalRationale: 'No acute suicidal/homicidal ideation or intent. Patient presents with protective factors.',
  safetyActionsTaken: ['Safety Plan Reviewed/Updated', 'Emergency Contacts Confirmed'],
};

type Props = {
  value: RiskAssessmentValue;
  onChange: (value: RiskAssessmentValue) => void;
  disabled?: boolean;
};

export function RiskAssessmentWidget({ value = DEFAULT_RISK_VALUE, onChange, disabled = false }: Props) {
  const updateField = <K extends keyof RiskAssessmentValue>(key: K, val: RiskAssessmentValue[K]) => {
    if (disabled) return;
    onChange({ ...value, [key]: val });
  };

  const toggleSafetyAction = (action: string) => {
    if (disabled) return;
    const current = value.safetyActionsTaken || [];
    const updated = current.includes(action)
      ? current.filter((a) => a !== action)
      : [...current, action];
    onChange({ ...value, safetyActionsTaken: updated });
  };

  const getRiskColor = (level: RiskAssessmentValue['overallRiskLevel']) => {
    switch (level) {
      case 'LOW': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'MEDIUM': return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'HIGH': return 'bg-red-50 text-red-700 border-red-200';
      case 'SEVERE': return 'bg-purple-900 text-white border-purple-950';
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-red-100 bg-red-50/30 p-5 shadow-sm">
      <div className="flex items-center justify-between border-b border-red-100 pb-3">
        <h3 className="text-base font-bold text-gray-900">Clinical Risk Assessment</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Overall Level:</span>
          <select
            value={value.overallRiskLevel || 'LOW'}
            onChange={(e) => updateField('overallRiskLevel', e.target.value as RiskAssessmentValue['overallRiskLevel'])}
            disabled={disabled}
            className={`rounded-full border px-3 py-1 text-xs font-bold shadow-sm outline-none ${getRiskColor(value.overallRiskLevel)}`}
          >
            <option value="LOW">LOW RISK</option>
            <option value="MEDIUM">MEDIUM RISK</option>
            <option value="HIGH">HIGH RISK</option>
            <option value="SEVERE">SEVERE / CRISIS RISK</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Suicidal Ideation */}
        <div className="rounded-xl border border-gray-200 bg-white p-3.5">
          <label className="block text-xs font-bold text-gray-800">Suicidal Ideation</label>
          <select
            value={value.suicidalIdeation || 'Denied'}
            onChange={(e) => updateField('suicidalIdeation', e.target.value as RiskAssessmentValue['suicidalIdeation'])}
            disabled={disabled}
            className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none focus:border-red-400"
          >
            <option value="Denied">Denied (No thoughts)</option>
            <option value="Passive">Passive (Wished to go to sleep/not wake up)</option>
            <option value="Active without Plan">Active (Thoughts of suicide without plan)</option>
            <option value="Active with Plan/Intent">Active (Thoughts with Plan or Intent)</option>
          </select>

          {value.suicidalIdeation !== 'Denied' && (
            <textarea
              rows={2}
              placeholder="Frequency, duration, and details of ideation…"
              value={value.ideationDetails || ''}
              onChange={(e) => updateField('ideationDetails', e.target.value)}
              disabled={disabled}
              className="mt-2 w-full rounded-xl border border-red-200 bg-red-50/50 p-2.5 text-xs text-red-900 outline-none focus:border-red-500"
            />
          )}
        </div>

        {/* Access to Means */}
        <div className="rounded-xl border border-gray-200 bg-white p-3.5">
          <label className="block text-xs font-bold text-gray-800">Access to Lethal Means</label>
          <select
            value={value.accessToMeans || 'No'}
            onChange={(e) => updateField('accessToMeans', e.target.value as RiskAssessmentValue['accessToMeans'])}
            disabled={disabled}
            className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none focus:border-red-400"
          >
            <option value="No">No (Means restricted / None available)</option>
            <option value="Yes">Yes (Firearms / Medications accessible)</option>
            <option value="Unknown">Unknown / Unconfirmed</option>
          </select>

          {value.accessToMeans === 'Yes' && (
            <textarea
              rows={2}
              placeholder="Detail specific lethal means accessible (firearms, stockpiled meds)…"
              value={value.meansDetails || ''}
              onChange={(e) => updateField('meansDetails', e.target.value)}
              disabled={disabled}
              className="mt-2 w-full rounded-xl border border-red-200 bg-red-50/50 p-2.5 text-xs text-red-900 outline-none focus:border-red-500"
            />
          )}
        </div>

        {/* Prior Attempts & NSSI */}
        <div className="rounded-xl border border-gray-200 bg-white p-3.5">
          <label className="block text-xs font-bold text-gray-800">Prior Attempts & Self-Harm</label>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <div>
              <span className="text-[11px] text-gray-500">Prior Attempts</span>
              <select
                value={value.priorAttempts || 'None'}
                onChange={(e) => updateField('priorAttempts', e.target.value as RiskAssessmentValue['priorAttempts'])}
                disabled={disabled}
                className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-xs outline-none focus:border-red-400"
              >
                <option value="None">None</option>
                <option value="1 Attempt">1 Attempt</option>
                <option value="Multiple Attempts">Multiple Attempts</option>
              </select>
            </div>
            <div>
              <span className="text-[11px] text-gray-500">NSSI</span>
              <select
                value={value.nonSuicidalSelfInjury || 'Denied'}
                onChange={(e) => updateField('nonSuicidalSelfInjury', e.target.value as RiskAssessmentValue['nonSuicidalSelfInjury'])}
                disabled={disabled}
                className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-xs outline-none focus:border-red-400"
              >
                <option value="Denied">Denied</option>
                <option value="Past History">Past History</option>
                <option value="Recent/Active">Recent/Active</option>
              </select>
            </div>
          </div>
        </div>

        {/* Homicidal Ideation */}
        <div className="rounded-xl border border-gray-200 bg-white p-3.5">
          <label className="block text-xs font-bold text-gray-800">Homicidal / Violent Ideation</label>
          <select
            value={value.homicidalIdeation || 'Denied'}
            onChange={(e) => updateField('homicidalIdeation', e.target.value as RiskAssessmentValue['homicidalIdeation'])}
            disabled={disabled}
            className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none focus:border-red-400"
          >
            <option value="Denied">Denied (No thoughts of harming others)</option>
            <option value="Present without Plan">Present without specific plan</option>
            <option value="Present with Plan/Intent">Present with specific target/plan</option>
          </select>

          {value.homicidalIdeation !== 'Denied' && (
            <textarea
              rows={2}
              placeholder="Target person, plan, or duty to warn details…"
              value={value.homicidalDetails || ''}
              onChange={(e) => updateField('homicidalDetails', e.target.value)}
              disabled={disabled}
              className="mt-2 w-full rounded-xl border border-red-200 bg-red-50/50 p-2.5 text-xs text-red-900 outline-none focus:border-red-500"
            />
          )}
        </div>
      </div>

      {/* Rationale & Safety Actions */}
      <div className="rounded-xl border border-gray-200 bg-white p-3.5 space-y-3">
        <div>
          <label className="block text-xs font-bold text-gray-800">Clinician Risk Rationale & Formulations</label>
          <textarea
            rows={2}
            value={value.clinicalRationale || ''}
            onChange={(e) => updateField('clinicalRationale', e.target.value)}
            disabled={disabled}
            placeholder="Clinical rationale supporting the overall risk rating selection…"
            className="mt-1.5 w-full rounded-xl border border-gray-200 p-3 text-xs outline-none focus:border-red-400"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-800">Safety Actions Executed</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[
              'Safety Plan Reviewed/Updated',
              'Lethal Means Restriction Counselled',
              'Emergency Contacts Confirmed',
              '988 Crisis Line Provided',
              'Escorted to ER / Mobile Crisis Initiated',
              'Duty to Warn / Law Enforcement Contacted',
            ].map((action) => {
              const active = (value.safetyActionsTaken || []).includes(action);
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => toggleSafetyAction(action)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    active
                      ? 'bg-red-600 text-white'
                      : 'border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {action}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

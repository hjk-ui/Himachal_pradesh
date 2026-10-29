'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiJson } from '@/lib/api-client';
import { MFA_COPY } from '@/lib/mfa/messages';

type Props = {
  /** Called once the server accepted the code (verified cookie is already set). */
  onVerified: () => void | Promise<void>;
  /** Optional escape hatch (e.g. back to the password step). */
  onCancel?: () => void;
};

const inputClass =
  'w-full min-h-12 rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-center text-lg font-semibold tracking-[0.32em] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10';

export function MfaChallenge({ onVerified, onCancel }: Props) {
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const canSubmit = recoveryMode ? code.trim().length >= 8 : code.length === 6;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;
    setError('');
    setLoading(true);
    try {
      await apiJson(recoveryMode ? '/api/auth/mfa/recovery' : '/api/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ code: recoveryMode ? code.trim() : code, remember }),
      });
      await onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setRecoveryMode((v) => !v);
    setCode('');
    setError('');
  };

  return (
    <form onSubmit={submit} className="space-y-5" aria-labelledby="mfa-title">
      <div>
        <h2 id="mfa-title" className="text-xl font-semibold text-slate-950">
          {MFA_COPY.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {recoveryMode ? MFA_COPY.recoveryPrompt : MFA_COPY.prompt}
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-5 text-rose-700"
        >
          {error}
        </div>
      ) : null}

      <input
        key={recoveryMode ? 'recovery' : 'totp'}
        type="text"
        inputMode={recoveryMode ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        autoFocus
        maxLength={recoveryMode ? 20 : 6}
        value={code}
        onChange={(e) =>
          setCode(
            recoveryMode
              ? e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
              : e.target.value.replace(/\D/g, '').slice(0, 6)
          )
        }
        className={inputClass}
        placeholder={recoveryMode ? 'XXXX-XXXX' : '------'}
        aria-label={recoveryMode ? 'Recovery code' : '6-digit code'}
      />

      <label className="flex min-h-10 items-center gap-2.5 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 accent-[#5C2D91]"
        />
        {MFA_COPY.remember}
      </label>

      <Button type="submit" size="lg" loading={loading} disabled={!canSubmit} className="w-full">
        {MFA_COPY.verify}
      </Button>

      <div className="flex flex-col items-center gap-1 text-center">
        <button
          type="button"
          onClick={toggleMode}
          className="min-h-10 text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline"
        >
          {recoveryMode ? MFA_COPY.useAuthenticator : MFA_COPY.useRecovery}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-10 text-sm font-semibold text-slate-500 hover:text-slate-700 hover:underline"
          >
            Back to sign in
          </button>
        ) : null}
      </div>
    </form>
  );
}

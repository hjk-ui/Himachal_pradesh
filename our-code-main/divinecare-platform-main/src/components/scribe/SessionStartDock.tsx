'use client';

import { useRef } from 'react';
import { Mic, Upload, FileAudio } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  allowedActions,
  DICTATE_RECAP_MAX_MINUTES,
  type ScribeBlocked,
} from '@/lib/scribe-session/blocked';

const COPY = {
  record: 'Record session',
  upload: 'Upload audio',
  dictate: 'Dictate a recap',
} as const;

type Props = {
  /** Viewer role — the dock renders only when the role can open /dashboard/scribe. */
  role: string | null | undefined;
  /** From resolveScribeBlocked(); null/undefined = nothing blocked. */
  blocked?: ScribeBlocked | null;
  onRecord: () => void;
  onUpload: (file: File) => void;
  /** Recap dictation is capped; the cap is passed through so the recorder enforces it. */
  onDictate: (opts: { maxSeconds: number }) => void;
  busy?: boolean;
  className?: string;
};

/** One-click session start: Record session · Upload audio · Dictate a recap. */
export function SessionStartDock({ role, blocked = null, onRecord, onUpload, onDictate, busy, className = '' }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  if (!canAccessPath(role, '/dashboard/scribe')) return null;

  const allowed = allowedActions(blocked);

  return (
    <div
      role="group"
      aria-label="Start a session"
      className={`rounded-xl border border-slate-200 bg-white p-3 shadow-xs ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onRecord} disabled={!allowed.record || busy}>
          <Mic size={15} aria-hidden />
          {COPY.record}
        </Button>
        <Button
          variant="secondary"
          onClick={() => fileRef.current?.click()}
          disabled={!allowed.upload || busy}
        >
          <Upload size={15} aria-hidden />
          {COPY.upload}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="sr-only"
          tabIndex={-1}
          aria-label={COPY.upload}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onUpload(file);
          }}
        />
        <Button
          variant="secondary"
          onClick={() => onDictate({ maxSeconds: DICTATE_RECAP_MAX_MINUTES * 60 })}
          disabled={!allowed.dictate || busy}
        >
          <FileAudio size={15} aria-hidden />
          {COPY.dictate}
          <span className="text-[11px] font-medium text-slate-500">max {DICTATE_RECAP_MAX_MINUTES} min</span>
        </Button>
      </div>
      {blocked ? (
        <p role="status" className="mt-2 text-[13px] text-slate-600">
          {blocked.reason}
        </p>
      ) : null}
    </div>
  );
}

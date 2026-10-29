'use client';

import { forwardRef, useCallback, useEffect, useState, type KeyboardEvent, type TextareaHTMLAttributes } from 'react';
import { SMART_PHRASES, type SmartPhrase } from '@/lib/ehr/smartPhrases';
import { apiJson } from '@/lib/api-client';

export type PhraseOption = { key: string; label: string; text: string; category?: string | null; mine?: boolean };

let cache: PhraseOption[] | null = null;
let inflight: Promise<PhraseOption[]> | null = null;
/** Every mounted hook, so a reload after editing phrases updates all open note fields */
const listeners = new Set<(phrases: PhraseOption[]) => void>();

const builtIns = (): PhraseOption[] =>
  SMART_PHRASES.map((p: SmartPhrase) => ({ key: p.key, label: p.label, text: p.text, category: p.category }));

function fetchPhrases(force: boolean): Promise<PhraseOption[]> {
  if (force) {
    cache = null;
    inflight = null;
  }
  if (cache) return Promise.resolve(cache);
  inflight ??= apiJson<{ success: true; phrases: PhraseOption[] }>('/api/smart-phrases')
    .then((d) => {
      // Custom phrases win over a built-in with the same key
      const custom = d.phrases || [];
      const keys = new Set(custom.map((p) => p.key));
      cache = [...custom, ...builtIns().filter((p) => !keys.has(p.key))];
      return cache;
    })
    .catch(() => {
      // Not cached, so a later mount retries; built-ins keep working meanwhile
      inflight = null;
      return builtIns();
    });
  return inflight;
}

/** Built-in phrases plus the organization's and the signed-in user's own (from /api/smart-phrases) */
export function useSmartPhrases(): { phrases: PhraseOption[]; reload: () => void } {
  const [phrases, setPhrases] = useState<PhraseOption[]>(cache ?? builtIns());
  useEffect(() => {
    listeners.add(setPhrases);
    void fetchPhrases(false).then(setPhrases);
    return () => {
      listeners.delete(setPhrases);
    };
  }, []);
  const reload = useCallback(() => {
    void fetchPhrases(true).then((next) => listeners.forEach((fn) => fn(next)));
  }, []);
  return { phrases, reload };
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
};

/**
 * Textarea that expands dot-phrases: type ".key" then Space or Tab.
 * Unknown keys are left as typed. Phrases contain [___] blanks the clinician must fill before signing.
 */
export const SmartPhraseTextarea = forwardRef<HTMLTextAreaElement, Props>(function SmartPhraseTextarea(
  { value, onChange, onKeyDown, ...rest },
  ref
) {
  const { phrases } = useSmartPhrases();

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || (e.key !== ' ' && e.key !== 'Tab')) return;
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return;
    const caret = el.selectionStart;
    const m = value.slice(0, caret).match(/(^|\s)(\.[a-z0-9][a-z0-9_-]*)$/i);
    if (!m) return;
    const hit = phrases.find((p) => p.key.toLowerCase() === m[2].toLowerCase());
    if (!hit) return;
    e.preventDefault();
    const start = caret - m[2].length;
    const next = value.slice(0, start) + hit.text + value.slice(caret);
    onChange(next);
    const pos = start + hit.text.length;
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = pos;
    });
  };

  return <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={handleKeyDown} {...rest} />;
});

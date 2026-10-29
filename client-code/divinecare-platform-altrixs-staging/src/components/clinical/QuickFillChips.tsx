'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

type Props = {
  phrases: string[] | undefined;
  onInsert: (phrase: string) => void;
};

/** Collapsible phrase chips under a textarea; a chip appends its phrase to the field */
export function QuickFillChips({ phrases, onInsert }: Props) {
  const [open, setOpen] = useState(false);
  if (!phrases?.length) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] font-bold text-[#5C2D91] hover:text-purple-900"
      >
        <Sparkles size={11} /> Quick fill {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
      {open ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {phrases.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                onInsert(p);
                setOpen(false);
              }}
              className="max-w-sm rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-left text-[11px] leading-snug text-purple-900 hover:bg-purple-100"
            >
              + {p}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Append a phrase to existing text with a single separating space */
export function appendPhrase(current: string, phrase: string) {
  if (!current) return phrase;
  return /[\s]$/.test(current) ? current + phrase : `${current} ${phrase}`;
}

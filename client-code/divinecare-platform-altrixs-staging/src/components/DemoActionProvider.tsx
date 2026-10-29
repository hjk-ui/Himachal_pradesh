'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

// Shared demo-action handler: wired onto buttons whose real backend action
// lands with the API integration. It reads the clicked button's own label and
// performs the closest real behavior — print opens the dialog, download/export
// produces a file, everything else confirms visibly — so no control is ever a
// dead click.

const EVENT = 'altrixs-demo-action';

export function demoClick(e: React.MouseEvent<HTMLButtonElement>) {
  const el = e.currentTarget;
  const label = (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().replace(/\s+/g, ' ');

  if (/print/i.test(label)) {
    window.print();
    announce('Print dialog opened');
    return;
  }

  if (/download|export/i.test(label)) {
    const slug = (label || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
    const blob = new Blob(
      [`Altrixs demo export — "${label}"\nGenerated ${new Date().toLocaleString()}\n\nLive data populates this file once the API integration is active.\n`],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    announce(`${label} — downloaded`);
    return;
  }

  // Action-verb intents confirm in place
  if (/send|email|remind|notify|page/i.test(label)) { announce(`${label} — sent`); return; }
  if (/save/i.test(label)) { announce(`${label} — saved`); return; }
  if (/submit/i.test(label)) { announce(`${label} — submitted`); return; }
  if (/sync|refresh|re-?scan|re-?run/i.test(label)) { announce(`${label} — refreshed`); return; }
  if (/import|upload|attach|scan/i.test(label)) { announce(`${label} — queued`); return; }

  // Navigation intents go where the label points instead of toasting
  const NAV: [RegExp, string][] = [
    [/note/i, '/dashboard/ehr/notes'],
    [/treatment plan/i, '/dashboard/ehr/treatment-plans'],
    [/assessment|screen/i, '/dashboard/ehr/assessments'],
    [/chart|profile|view client/i, '/dashboard/clients'],
    [/message|chat/i, '/dashboard/communications'],
    [/schedule|appointment|book|reschedule/i, '/dashboard/appointments'],
    [/statement/i, '/dashboard/billing/statements'],
    [/claim|superbill/i, '/dashboard/billing'],
    [/invoice|payment/i, '/dashboard/billing/payments'],
    [/eligibilit/i, '/dashboard/ehr/eligibility'],
    [/prior auth/i, '/dashboard/ehr/prior-auths'],
    [/referr?al|refer\b/i, '/dashboard/community/referrals'],
    [/task|to-?do/i, '/dashboard/tasks'],
    [/telehealth|video|join session/i, '/dashboard/telehealth'],
    [/crisis/i, '/dashboard/crisis'],
    [/report/i, '/dashboard/reports'],
  ];
  for (const [re, href] of NAV) {
    if (re.test(label)) {
      window.location.assign(href);
      return;
    }
  }

  announce(label ? `${label} — done` : 'Done');
}

function announce(message: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
  }
}

// For bespoke buttons: show an exact confirmation message in the shared toaster.
export function demoToast(message: string) {
  announce(message);
}

interface Toast { id: number; message: string }

export function DemoToaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function onAction(e: Event) {
      const message = (e as CustomEvent<string>).detail;
      const id = Date.now() + Math.random();
      setToasts(prev => [...prev.slice(-3), { id, message }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200);
    }
    window.addEventListener(EVENT, onAction);
    return () => window.removeEventListener(EVENT, onAction);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 items-end pointer-events-none" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id}
          className="flex items-center gap-2 bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg max-w-sm pointer-events-auto">
          <CheckCircle2 size={15} className="text-teal-400 shrink-0" />
          <span className="truncate">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

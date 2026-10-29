import { Phone } from 'lucide-react';

/** Crisis resources shown on patient-facing pages: 988 (call or text) and 911. */
export function CrisisFooter({ className = '' }: { className?: string }) {
  return (
    <aside
      aria-label="Crisis resources"
      className={`flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 ${className}`.trim()}
    >
      <Phone size={16} className="mt-0.5 shrink-0" aria-hidden />
      <p>
        In crisis? Call or text{' '}
        <a href="tel:988" className="font-semibold underline underline-offset-2">
          988
        </a>
        , or call{' '}
        <a href="tel:911" className="font-semibold underline underline-offset-2">
          911
        </a>
        .
      </p>
    </aside>
  );
}

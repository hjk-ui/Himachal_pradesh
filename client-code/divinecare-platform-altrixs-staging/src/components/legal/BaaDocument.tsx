import { BAA_PREAMBLE, BAA_SECTIONS, BAA_TITLE, BAA_VERSION } from '@/lib/legal/baa';

/** The BAA text (src/lib/legal/baa.ts) as readable, printable markup. headingLevel sets the title tag. */
export function BaaDocument({ headingLevel = 'h2', showTitle = true }: { headingLevel?: 'h1' | 'h2' | 'h3'; showTitle?: boolean }) {
  const Title = headingLevel;
  const Section = headingLevel === 'h1' ? 'h2' : headingLevel === 'h2' ? 'h3' : 'h4';
  return (
    <article className="space-y-5 text-sm leading-relaxed text-slate-700">
      {showTitle ? (
        <header>
          <Title className="text-xl font-bold text-[#141C34]">{BAA_TITLE}</Title>
          <p className="mt-1 text-xs text-slate-500">Version {BAA_VERSION}</p>
        </header>
      ) : null}
      {BAA_PREAMBLE.map((p) => (
        <p key={p.slice(0, 40)}>{p}</p>
      ))}
      {BAA_SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="space-y-2 break-inside-avoid-page">
          <Section className="text-base font-bold text-[#141C34]">{s.heading}</Section>
          {s.paragraphs.map((p) => (
            <p key={p.slice(0, 48)}>{p}</p>
          ))}
        </section>
      ))}
    </article>
  );
}

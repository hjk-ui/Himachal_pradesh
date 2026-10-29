/**
 * Outdated-browser check (pure). Baseline = what Next.js 16 supports: Chrome / Edge / Firefox 111+,
 * Safari 16.4+ (all iOS / iPadOS browsers use Safari's engine, so the iOS version decides there).
 * Unknown browsers are never flagged — the banner is a nudge, not a block.
 */
export const MIN_BROWSER = { chrome: 111, edge: 111, firefox: 111, safari: [16, 4] as const };

export type BrowserCheck = { outdated: boolean; browser: string | null; version: string | null };

function major(m: RegExpMatchArray | null): number | null {
  return m ? Number(m[1]) : null;
}

export function checkBrowser(ua: string | null | undefined): BrowserCheck {
  const s = ua || '';
  const ok = (browser: string, version: string | null, outdated: boolean): BrowserCheck => ({ browser, version, outdated });

  // iOS / iPadOS: every browser is WebKit; the OS version is the Safari version
  const ios = s.match(/(?:iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/);
  if (ios) {
    const [maj, min] = [Number(ios[1]), Number(ios[2])];
    return ok('Safari (iOS)', `${maj}.${min}`, maj < MIN_BROWSER.safari[0] || (maj === MIN_BROWSER.safari[0] && min < MIN_BROWSER.safari[1]));
  }
  const edge = major(s.match(/Edg(?:e|A|iOS)?\/(\d+)/));
  if (edge !== null) return ok('Edge', String(edge), edge < MIN_BROWSER.edge);
  const firefox = major(s.match(/Firefox\/(\d+)/));
  if (firefox !== null) return ok('Firefox', String(firefox), firefox < MIN_BROWSER.firefox);
  const chrome = major(s.match(/(?:Chrome|Chromium|CriOS)\/(\d+)/));
  if (chrome !== null) return ok('Chrome', String(chrome), chrome < MIN_BROWSER.chrome);
  const safari = s.match(/Version\/(\d+)(?:\.(\d+))?.*Safari\//);
  if (safari) {
    const [maj, min] = [Number(safari[1]), Number(safari[2] || 0)];
    return ok('Safari', `${maj}.${min}`, maj < MIN_BROWSER.safari[0] || (maj === MIN_BROWSER.safari[0] && min < MIN_BROWSER.safari[1]));
  }
  // Internet Explorer: always outdated
  if (/MSIE |Trident\//.test(s)) return ok('Internet Explorer', null, true);
  return { outdated: false, browser: null, version: null };
}

export const OUTDATED_BROWSER_MESSAGE = 'Your browser is out of date. Please update to keep Altrixs secure.';

/**
 * Global keyboard shortcuts for the staff app (pure; tested). The listener lives in
 * DashboardCommandSearch; the "?" dialog lists SHORTCUTS. Shortcuts never fire while the user is
 * typing (inputs, selects, text areas, rich-text editors) or with Ctrl / Cmd / Alt held.
 */

export type ShortcutCommand =
  | { kind: 'go'; href: string }
  | { kind: 'new_note' }
  | { kind: 'search' }
  | { kind: 'help' };

export type ShortcutHelp = { keys: string[]; label: string };

export const GO_TARGETS: Record<string, { href: string; label: string }> = {
  i: { href: '/dashboard/inbox', label: 'Open inbox' },
  s: { href: '/dashboard/appointments', label: 'Open schedule' },
  t: { href: '/dashboard/tasks', label: 'My To-Do' },
};

export const SHORTCUTS: ShortcutHelp[] = [
  { keys: ['Ctrl', 'K'], label: 'Command palette (Cmd K on Mac)' },
  { keys: ['/'], label: 'Search' },
  { keys: ['g', 'i'], label: GO_TARGETS.i.label },
  { keys: ['g', 's'], label: GO_TARGETS.s.label },
  { keys: ['g', 't'], label: GO_TARGETS.t.label },
  { keys: ['n'], label: 'New note for the client you are viewing' },
  { keys: ['?'], label: 'Show keyboard shortcuts' },
];

/** A "g" waits this long for its second key. */
export const SEQUENCE_TIMEOUT_MS = 1200;

type TargetLike = {
  tagName?: string;
  isContentEditable?: boolean;
  type?: string;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
} | null | undefined;

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'number', 'password', 'tel', 'url', 'date', 'datetime-local', 'time', 'month', 'week']);

/** The key press belongs to a text field or editor, not to the app. */
export function isTypingTarget(target: TargetLike): boolean {
  if (!target) return false;
  const tag = String(target.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return TEXT_INPUT_TYPES.has(String(target.type || '').toLowerCase());
  if (target.isContentEditable) return true;
  const role = target.getAttribute?.('role');
  if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return true;
  return Boolean(target.closest?.('[contenteditable="true"], [contenteditable=""], [role="textbox"]'));
}

/**
 * One key of a shortcut. `pendingG` = a "g" was pressed just before. Returns the command (if
 * any) and whether a "g" is now pending.
 */
export function resolveShortcut(pendingG: boolean, key: string): { command: ShortcutCommand | null; pendingG: boolean } {
  if (pendingG) {
    const target = GO_TARGETS[key.toLowerCase()];
    return { command: target ? { kind: 'go', href: target.href } : null, pendingG: false };
  }
  if (key === 'g') return { command: null, pendingG: true };
  if (key === 'n') return { command: { kind: 'new_note' }, pendingG: false };
  if (key === '/') return { command: { kind: 'search' }, pendingG: false };
  if (key === '?') return { command: { kind: 'help' }, pendingG: false };
  return { command: null, pendingG: false };
}

/** Should this keydown be considered for a global shortcut at all? */
export function shortcutEligible(e: { key?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; defaultPrevented?: boolean; repeat?: boolean; target?: unknown }): boolean {
  if (!e.key || e.defaultPrevented || e.repeat) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return !isTypingTarget(e.target as TargetLike);
}

const NOT_CLIENT_IDS = new Set(['intake', 'new', 'import', 'merge', 'discharged']);

/** The client in view: /dashboard/clients/<id>[/...] or a ?clientId= on the page. */
export function clientIdInContext(pathname: string | null | undefined, search?: string | null): string | null {
  const m = /^\/dashboard\/clients\/([^/?#]+)/.exec(pathname || '');
  if (m && !NOT_CLIENT_IDS.has(m[1])) return decodeURIComponent(m[1]);
  const q = new URLSearchParams(search || '').get('clientId');
  return q && /^[A-Za-z0-9_-]{1,128}$/.test(q) ? q : null;
}

/** Every word of the query appears in the text (case-insensitive). */
export function matchesAllWords(text: string, query: string): boolean {
  const hay = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

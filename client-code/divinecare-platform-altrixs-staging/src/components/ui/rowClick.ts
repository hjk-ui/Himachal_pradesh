/**
 * Row click helper for tables whose whole row opens a record. Ignores clicks that land on
 * (or inside) a link, button, form control or menu, and text selections, so those keep
 * their own behaviour. Keyboard users use the row's primary link.
 */
export function isRowClickTarget(e: { target: EventTarget | null }): boolean {
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest('a, button, input, select, textarea, label, [role="menu"], [data-row-actions]')) return false;
  try {
    const sel = window.getSelection?.();
    if (sel && sel.toString().length > 0) return false;
  } catch {
    /* ignore */
  }
  return true;
}

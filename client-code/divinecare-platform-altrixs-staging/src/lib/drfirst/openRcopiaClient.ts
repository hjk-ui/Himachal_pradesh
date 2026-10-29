'use client';

/**
 * Opens Rcopia in a new browser tab (GM11: never an iframe). The tab is opened synchronously on
 * click so the pop-up blocker allows it, then pointed at the signed SSO URL. With a patient, the
 * server uploads the patient's demographics, problems, allergies and medications first (GM10).
 * Call it straight from the click handler (before any other await).
 */
export async function openRcopia(params: Record<string, string>): Promise<{ ok: boolean; message?: string }> {
  const win = window.open('about:blank', '_blank');
  try {
    const res = await fetch(`/api/drfirst/sso?${new URLSearchParams(params)}`);
    const data = (await res.json().catch(() => ({}))) as {
      url?: string; demo?: boolean; error?: string; message?: string; missing?: string[];
      patientSynced?: boolean | null; registerNote?: string;
    };
    if (!res.ok || !data.url || data.demo) {
      win?.close();
      const missing = data.missing?.length ? ` Missing: ${data.missing.join(', ')}.` : '';
      return { ok: false, message: `${data.error || data.message || 'DrFirst could not be opened.'}${missing}` };
    }
    if (win) win.location.href = data.url;
    else window.open(data.url, '_blank');
    if (params.patient && data.patientSynced === false) {
      return {
        ok: true,
        message: `DrFirst opened on patient search because this patient is not in DrFirst yet${data.registerNote ? ` (${data.registerNote})` : ''}.`,
      };
    }
    return { ok: true };
  } catch {
    win?.close();
    return { ok: false, message: 'Could not reach DrFirst. Try again.' };
  }
}

/** Event fired after a DrFirst download refreshed a chart (return from Rcopia or Refresh from DrFirst). */
export const DRFIRST_SYNCED_EVENT = 'altrixs:drfirst-synced';

export interface DrFirstSyncedDetail {
  clientId: string;
  totals: Record<string, number>;
  throttled: boolean;
}

export function dispatchDrFirstSynced(detail: DrFirstSyncedDetail): void {
  window.dispatchEvent(new CustomEvent<DrFirstSyncedDetail>(DRFIRST_SYNCED_EVENT, { detail }));
}

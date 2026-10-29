"use client";
import { inputClasses, cx } from '@/components/ui';
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth";
import { fetchClients } from "@/features/clients";
import type { ConnectionStatus, MockFailure } from "@/lib/drfirst/types";
import { getApprovedLaunchUrl } from "@/lib/drfirst/validation";

export function DrFirstPanel({
  prescriber,
  harness = false,
  allowFailures = false,
  previewMode = false,
  defaultClientId,
}: {
  prescriber: boolean;
  harness?: boolean;
  allowFailures?: boolean;
  previewMode?: boolean;
  defaultClientId?: string;
}) {
  const { user } = useAuth();
  const isPreview =
    previewMode ||
    Boolean(
      user?.rolePreview ||
      (user?.baseRole === "ADMIN" && user?.role !== "ADMIN")
    );
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [clientId, setClientId] = useState(defaultClientId || "");
  const [message, setMessage] = useState("Checking integration configuration…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (defaultClientId && !clientId) {
      setClientId(defaultClientId);
    }
  }, [defaultClientId, clientId]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (isPreview) {
        if (!active) return;
        setStatus({
          enabled: true,
          configured: false,
          mock: true,
          environment: "mock",
        });
        setMessage(
          harness
            ? "Role preview — DrFirst mock harness. Nothing is prescribed or sent to DrFirst."
            : "Role preview — DrFirst is not connected here. Use E-Prescribe (DrFirst) from the client chart."
        );
        if (!harness) return;
        try {
          const rows = await fetchClients("prescribe");
          if (active) {
            const formatted = rows.map((row) => ({ id: row.id, name: row.name }));
            setClients(formatted);
            if (formatted.length > 0) {
              setClientId((prev) => prev || defaultClientId || formatted[0].id);
            }
          }
        } catch {
          // In preview mode, gracefully fallback if patients cannot be fetched
        }
        return;
      }
      try {
        const response = await fetch("/api/integrations/drfirst/status", {
          cache: "no-store",
        });
        const data = await response.json();
        if (!active) return;
        if (!response.ok) {
          setMessage(data.error || "Integration unavailable.");
          return;
        }
        setStatus(data);
        setMessage(
          !data.enabled
            ? "DrFirst integration is disabled. Contact your administrator."
            : data.configured
              ? "DrFirst integration connected."
              : harness && data.mock
                ? "MOCK harness — simulated only. Nothing is prescribed or sent to DrFirst."
                : "This panel is not connected to DrFirst. Use E-Prescribe (DrFirst) from the client chart.",
        );
        if (prescriber && data.enabled && (data.configured || (harness && data.mock))) {
          const rows = await fetchClients("prescribe");
          if (active) {
            const formatted = rows.map((row) => ({ id: row.id, name: row.name }));
            setClients(formatted);
            if (formatted.length > 0) {
              setClientId((prev) => prev || defaultClientId || formatted[0].id);
            }
          }
        }
      } catch {
        if (active)
          setMessage("Could not load integration configuration or patients.");
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [prescriber, isPreview, defaultClientId, harness]);

  async function launch(failure: MockFailure = "none") {
    setBusy(true);
    try {
      const response = await fetch("/api/integrations/drfirst/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          ...(failure !== "none" ? { failure } : {}),
        }),
      });
      const result = (await response.json()) as {
        code: string;
        error: string;
        data?: { launchUrl?: string };
      };
      if (!response.ok) {
        if (result.code === "DRFIRST_UNAUTHORIZED" && isPreview) {
          window.location.assign("/dashboard/ehr/prescriptions/mock");
          return;
        }
        setMessage(`${result.code}: ${result.error}`);
        return;
      }
      const launchUrl = getApprovedLaunchUrl(
        result.data?.launchUrl,
        status?.environment ?? "mock",
      );
      window.location.assign(launchUrl);
    } catch {
      setMessage("Launch unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Simulated launches only inside the mock harness page; never on the real prescriptions page
  const enabled = (prescriber || isPreview) && status?.enabled && (status.configured || (harness && status.mock));
  const canLaunch = !busy && Boolean(clientId);

  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">
          {harness
            ? "DrFirst Mock / Development Environment"
            : "DrFirst E-Prescribing Gateway"}
        </h2>
        {isPreview && (
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800 border border-blue-300">
            Preview / Demo Mode
          </span>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-sm text-slate-700">
        {message}
      </p>
      {enabled && (
        <>
          <label className="block text-sm font-medium text-slate-800">
            Patient
            <select
              className={cx(inputClasses, 'ml-3')}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            >
              <option value="">Select an assigned patient</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
          {clients.length === 0 && (
            <p className="text-sm text-slate-500">No assigned patients available.</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={!canLaunch}
              onClick={() => void launch()}
              className="rounded-xl bg-blue-700 hover:bg-blue-800 text-white px-5 py-2.5 font-semibold text-sm transition-all disabled:opacity-50 shadow-sm cursor-pointer"
            >
              {busy ? "Launching Rcopia Portal…" : "Open Certified DrFirst Portal (Demo)"}
            </button>
            {harness &&
              allowFailures &&
              (["patient", "prescriber", "unavailable"] as const).map(
                (failure) => (
                  <button
                    key={failure}
                    type="button"
                    disabled={busy || !clientId}
                    onClick={() => void launch(failure)}
                    className="rounded-xl border border-slate-300 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-700 disabled:opacity-50 transition-colors shadow-xs"
                  >
                    {failure === "unavailable"
                      ? "Simulate unavailable service"
                      : `Simulate ${failure === "prescriber" ? "provider" : "patient"} validation failure`}
                  </button>
                ),
              )}
          </div>
        </>
      )}
    </section>
  );
}

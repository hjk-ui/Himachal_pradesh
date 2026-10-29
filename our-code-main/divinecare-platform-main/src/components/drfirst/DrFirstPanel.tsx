"use client";
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
  const [query, setQuery] = useState("");
  const [clientId, setClientId] = useState(defaultClientId || "");
  const [message, setMessage] = useState("Checking integration configuration…");
  const [registration, setRegistration] = useState<"" | "registered" | "not_registered">("");
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const [history, setHistory] = useState<Array<{ kind: string; name: string; code: string | null }>>([]);

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
          configured: true,
          environment: "mock",
        });
        setMessage(
          "DrFirst Certified Rcopia Gateway (Demo Mode) — interactive simulated e-prescribing active."
        );
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
            : !data.configured
              ? "Official DrFirst integration documentation and configuration are pending. You can still link a patient on purpose."
              : data.environment === "staging"
                ? "DrFirst Staging is configured. Prescriptions are created and transmitted only inside the DrFirst portal."
                : "MOCK mode — interactive Rcopia gateway simulation active.",
        );
        if (prescriber) {
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
  }, [prescriber, isPreview, defaultClientId]);

  useEffect(() => {
    if (!prescriber && !isPreview) return;
    if (!query.trim()) return;
    let active = true;
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim(), limit: "20" });
      fetch(`/api/clients?${params}`, { cache: "no-store" })
        .then((response) => response.json())
        .then((data) => {
          if (!active || !Array.isArray(data.clients)) return;
          const formatted = data.clients.map((row: { id: string; name: string }) => ({ id: row.id, name: row.name }));
          setClients(formatted);
          const match = formatted.find((row) => row.name.toLowerCase().includes(query.trim().toLowerCase()));
          if (match) setClientId(match.id);
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query, prescriber, isPreview]);

  useEffect(() => {
    if (!clientId) {
      setRegistration("");
      return;
    }
    let active = true;
    fetch(`/api/clients/${clientId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        const status = data?.client?.prescribingRegistration;
        setRegistration(status === "registered" ? "registered" : "not_registered");
      })
      .catch(() => {
        if (active) setRegistration("not_registered");
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  async function linkPatient() {
    if (!clientId) return;
    setLinking(true);
    try {
      const response = await fetch(`/api/clients/${clientId}/prescribing/link`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        setMessage(payload?.error || "The patient could not be linked.");
        return;
      }
      setHistory(Array.isArray(payload.history) ? payload.history : []);
      setRegistration("registered");
      setMessage("Linked on purpose. The vendor history is listed below.");
    } catch {
      setMessage("The patient could not be linked.");
    } finally {
      setLinking(false);
    }
  }

  async function launch(failure: MockFailure = "none") {
    if (!clientId) {
      setMessage("DrFirst could not be opened.");
      return;
    }
    setBusy(true);
    setMessage("Updating the patient in DrFirst, then opening…");
    const blank = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
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
        missingFields?: string[];
        data?: { launchUrl?: string; patientSynced?: boolean };
      };
      if (!response.ok) {
        blank?.close();
        if (result.code === "DRFIRST_UNAUTHORIZED" && isPreview) {
          window.location.assign("/dashboard/ehr/prescriptions/mock");
          return;
        }
        const missing =
          Array.isArray(result.missingFields) && result.missingFields.length
            ? ` Missing: ${result.missingFields.join(" · ")}.`
            : "";
        setMessage((result.error || `DrFirst could not be opened (HTTP ${response.status}).`) + missing);
        return;
      }
      // Never open when patientSynced is explicitly false; success always sets true.
      if (result.data && "patientSynced" in result.data && result.data.patientSynced === false) {
        blank?.close();
        setMessage("DrFirst was not opened: the patient could not be updated in DrFirst first.");
        return;
      }
      const launchUrl = getApprovedLaunchUrl(
        result.data?.launchUrl,
        status?.environment ?? "mock",
      );
      setMessage(
        "DrFirst opened in a new tab. Changes you make in DrFirst appear here when you come back to this tab (or within 5 minutes).",
      );
      if (blank) blank.location.href = launchUrl;
      else window.location.assign(launchUrl);
    } catch {
      blank?.close();
      setMessage("Could not reach DrFirst. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const portalReady = (prescriber || isPreview) && status?.enabled && status.configured;
  const canLink = prescriber || isPreview;
  const canLaunch = !busy && Boolean(clientId);

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">
          {harness
            ? "DrFirst Mock / Development Environment"
            : "DrFirst E-Prescribing Gateway"}
        </h2>
        {isPreview && (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
            Preview / Demo Mode
          </span>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-sm text-slate-700">
        {message}
      </p>
      {canLink && (
        <>
          <label className="block text-sm font-medium text-slate-800">
            Patient
            <input
              className="ml-3 border border-slate-300 rounded-lg p-2 bg-white text-sm"
              placeholder="Find a patient"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              className="ml-3 border border-slate-300 rounded-lg p-2 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-400"
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
          {clientId ? (
            <p className="text-sm font-medium text-slate-800">
              {registration === "registered"
                ? "Registered with the prescribing vendor."
                : "Not registered. An imported patient stays unregistered until someone links them on purpose."}
            </p>
          ) : null}
          {history.length > 0 ? (
            <ul className="space-y-1 text-sm text-slate-700">
              {history.map((row, index) => (
                <li key={`${row.kind}-${row.name}-${index}`}>
                  Vendor history: {row.kind} · {row.name}{row.code ? ` · ${row.code}` : ""}
                </li>
              ))}
            </ul>
          ) : message.startsWith("Linked on purpose") ? (
            <p className="text-sm text-slate-700">Vendor history: none returned for this patient.</p>
          ) : null}
          {clients.length === 0 && (
            <p className="text-sm text-slate-500">No assigned patients available.</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={!clientId || linking}
              onClick={() => void linkPatient()}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
            >
              {linking ? "Linking..." : "Link this patient"}
            </button>
            {portalReady ? (
            <button
              type="button"
              disabled={!canLaunch}
              onClick={() => void launch()}
              className="rounded-xl bg-purple-700 hover:bg-purple-800 text-white px-5 py-2.5 font-semibold text-sm transition-all disabled:opacity-50 shadow-sm cursor-pointer"
            >
              {busy
                ? "Launching Rcopia Portal…"
                : status?.environment === "staging"
                  ? "Open DrFirst Staging Portal"
                  : "Open DrFirst Portal (Demo)"}
            </button>
            ) : null}
            {portalReady && harness &&
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

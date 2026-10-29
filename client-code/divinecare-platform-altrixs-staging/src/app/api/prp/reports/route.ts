import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { errorResponse, fail, monthSchema, ok, prpGate, reportTypeSchema } from '@/lib/prp/http';
import { loadAttendance, loadEnrollments, loadGroups, loadIrps, loadMors } from '@/lib/prp/program';
import {
  billingSummaryReport,
  groupAttendanceReport,
  monthBounds,
  monthlyProgressReport,
  morsReport,
  REPORT_COLUMNS,
  toCsv,
  transitionReport,
  type PrpReportType,
} from '@/lib/prp/reports';
import { PRP_BILLING_RULE_NOTE } from '@/lib/prp/billingRule';
import { loadPrpSettingsRow } from '@/lib/prp/settings';
import { prpBillingState } from '@/lib/prp/standard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TITLES: Record<PrpReportType, string> = {
  'monthly-progress': 'PRP Monthly Progress',
  'group-attendance': 'PRP Group Attendance',
  'billing-summary': 'PRP Medicaid Billing Summary (encounters)',
  transition: 'PRP Transition / Discharge',
  mors: 'PRP Outcome Measures (MORS)',
};

/** GET /api/prp/reports?type=&month=YYYY-MM[&format=csv] */
export async function GET(req: Request) {
  const g = await prpGate();
  if (!g.ok) return g.res;
  try {
    const url = new URL(req.url);
    const type = reportTypeSchema.safeParse(url.searchParams.get('type'));
    const month = monthSchema.safeParse(url.searchParams.get('month'));
    if (!type.success || !month.success) return fail('type and month (YYYY-MM) are required', 400);
    const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';
    const m = month.data;

    const [enrollments, settings] = await Promise.all([loadEnrollments(g.actor), loadPrpSettingsRow(g.actor.organizationId)]);
    const billing = prpBillingState(settings);
    const monthlyMinContacts = settings?.prpMonthlyMinContacts ?? null;
    const ids = enrollments.map((e) => e.id);
    const range = monthBounds(m);
    let rows: Record<string, unknown>[] = [];
    let extra: Record<string, unknown> = {};
    switch (type.data) {
      case 'monthly-progress': {
        const [attendance, irps, mors] = await Promise.all([
          // Up to month end: last service date may fall before the month
          loadAttendance(g.actor, ids, { start: new Date(0), end: range.end }),
          loadIrps([...new Set(enrollments.map((e) => e.clientId))]),
          loadMors(g.actor, ids, m),
        ]);
        rows = monthlyProgressReport({ month: m, enrollments, attendance, irps, mors, monthlyMinContacts });
        extra = {
          goalStatusNote:
            'IRP goal status (met / not met) is not stored. Counts are goals on the IRP and goals past their target date.',
        };
        break;
      }
      case 'group-attendance': {
        const [attendance, groups] = await Promise.all([loadAttendance(g.actor, ids, range), loadGroups(g.actor)]);
        rows = groupAttendanceReport({ month: m, groups, attendance });
        break;
      }
      case 'billing-summary': {
        const report = billingSummaryReport({ month: m, enrollments, attendance: await loadAttendance(g.actor, ids, range), billing, monthlyMinContacts });
        rows = report.rows;
        extra = {
          unitRuleConfirmed: billing.confirmed,
          // The practice-confirmed billing model (or "not confirmed"); units are never calculated here.
          unitRuleLabel: billing.label,
          ruleNote: `${billing.detail} ${PRP_BILLING_RULE_NOTE}`,
          billingConfirmedAt: billing.confirmedAt,
          totals: report.totals,
        };
        break;
      }
      case 'transition':
        rows = transitionReport({ month: m, enrollments });
        break;
      case 'mors': {
        const report = morsReport({ month: m, enrollments, mors: await loadMors(g.actor, ids, m) });
        rows = report.rows;
        extra = { recorded: report.recorded };
        break;
      }
    }

    const clientOf = new Map(enrollments.map((e) => [e.id, e.clientId]));
    const patientIds = [
      ...new Set(rows.map((r) => clientOf.get(String(r.enrollmentId ?? ''))).filter((v): v is string => !!v)),
    ];
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: format === 'csv' ? 'EXPORT' : 'READ',
      resourceType: 'prpReport',
      metadata: { type: type.data, month: m, format, rows: rows.length, patientIds: patientIds.slice(0, 50) },
    });

    if (format === 'csv') {
      const preamble = [`${TITLES[type.data]} - ${m}`, `Generated ${new Date().toISOString()}`];
      if (type.data === 'billing-summary') preamble.push(billing.label, PRP_BILLING_RULE_NOTE);
      if (type.data === 'billing-summary' || type.data === 'monthly-progress') {
        preamble.push(monthlyMinContacts == null ? 'Monthly contact minimum: not set (practice policy - confirm)' : `Monthly contact minimum: ${monthlyMinContacts} (practice policy)`);
      }
      const csv = toCsv(REPORT_COLUMNS[type.data], rows, preamble);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="prp-${type.data}-${m}.csv"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }
    return ok({ type: type.data, title: TITLES[type.data], month: m, columns: REPORT_COLUMNS[type.data], rows, ...extra });
  } catch (e) {
    return errorResponse(e, 'Could not build the report');
  }
}

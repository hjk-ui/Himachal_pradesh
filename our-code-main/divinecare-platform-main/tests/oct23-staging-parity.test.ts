import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

function read(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('ai-guardrails', () => {
  const bedrock = read('src/lib/ai/bedrockService.ts');
  const docs = read('docs/ai-guardrails.md');
  const envEx = read('.env.example');

  it('uses dual clinical/general env vars; ignores old single id', () => {
    assert.match(bedrock, /BEDROCK_GUARDRAIL_CLINICAL_ID/);
    assert.match(bedrock, /BEDROCK_GUARDRAIL_GENERAL_ID/);
    assert.match(bedrock, /never use deprecated BEDROCK_GUARDRAIL_ID/);
    assert.match(envEx, /BEDROCK_GUARDRAIL_CLINICAL_ID/);
    assert.match(envEx, /BEDROCK_GUARDRAIL_GENERAL_ID/);
    assert.doesNotMatch(bedrock, /process\.env\.BEDROCK_GUARDRAIL_ID/);
  });

  it('defaults to clinical guard and exact block messages', () => {
    assert.match(bedrock, /guard = 'clinical'/);
    assert.match(bedrock, /\[Altrixs AI safety filter\]/);
    assert.match(bedrock, /AI_SAFETY_BLOCKED/);
    assert.match(
      bedrock,
      /The AI safety filter blocked this request, so nothing was generated\./
    );
    assert.match(docs, /clinical/);
    assert.match(docs, /general/);
  });
});

describe('drfirst-launch-demographics', () => {
  const reg = read('src/lib/drfirst/register-on-launch.ts');
  const sso = read('src/app/api/integrations/drfirst/sso/route.ts');
  const waiting = read('src/components/drfirst/DrFirstWaiting.tsx');

  it('has exact incomplete demographics copy and 409 stop language', () => {
    assert.match(reg, /then open DrFirst again/);
    assert.match(reg, /DEMOGRAPHICS_INCOMPLETE|demographics/i);
    assert.match(reg, /Legal first name/);
    assert.match(reg, /UPLOAD_FAILED|could not be updated in DrFirst/i);
  });

  it('SSO success path has no registerNote', () => {
    assert.doesNotMatch(sso, /registerNote/);
    assert.match(sso, /patientSynced:\s*true/);
  });

  it('Waiting panel has exact 5-minute help and status copy', () => {
    assert.match(waiting, /Waiting in DrFirst/);
    assert.match(waiting, /every 5 minutes/);
    assert.match(waiting, /Reports/);
    assert.match(waiting, /Messages/);
  });
});

describe('drfirst-quick-refresh', () => {
  const screens = read('src/lib/drfirst/screens.ts');
  const waiting = read('src/components/drfirst/DrFirstWaiting.tsx');
  const docs = read('docs/DRFIRST-INTEGRATION.md');

  it('maps count keys to report/message screens and 5-min poll', () => {
    assert.match(screens, /pending_prescription:\s*'report'/);
    assert.match(screens, /need_signing:\s*'report'/);
    assert.match(screens, /refill:\s*'message'/);
    assert.match(screens, /rx_change:\s*'message'/);
    assert.match(screens, /UPDATE_POLL_MIN_MS = 5 \* 60_000/);
    assert.match(screens, /RETURN_HIDDEN_MIN_MS = 3_000/);
  });

  it('badge a11y and Refresh button copy', () => {
    assert.match(waiting, /aria-label="DrFirst counts"/);
    assert.match(waiting, /Refresh from DrFirst/);
    assert.match(waiting, /Refreshing…/);
    assert.match(docs, /\*\/5/);
  });
});

describe('notes-type-change-dismiss', () => {
  const dismiss = read('src/lib/notes/dismiss.ts');
  const typeChange = read('src/lib/notes/typeChange.ts');
  const dismissApi = read('src/app/api/notes/[id]/dismiss/route.ts');

  it('dismiss reasons, undo 30d, locked message', () => {
    assert.match(dismiss, /Created in error/);
    assert.match(dismiss, /Duplicate note/);
    assert.match(dismiss, /Visit didn't happen/);
    assert.match(dismiss, /Wrong client/);
    assert.match(dismiss, /Other…/);
    assert.match(dismiss, /DISMISS_UNDO_DAYS = 30/);
    assert.match(dismiss, /Only an unsigned note can be dismissed/);
    assert.match(dismissApi, /POST/);
    assert.match(dismissApi, /DELETE/);
  });

  it('type change carried-over exact copy', () => {
    assert.match(typeChange, /Change note type/);
    assert.match(typeChange, /Carried over from/);
    assert.match(typeChange, /Carried over/);
    assert.match(typeChange, /90791/);
    assert.match(typeChange, /90792/);
  });
});

describe('scribe-dismiss-templates', () => {
  const formats = read('src/lib/scribe/formats.ts');
  const scribeApi = read('src/app/api/agents/scribe/route.ts');

  it('includes prescriber formats and NEVER_AI headings', () => {
    assert.match(formats, /PSYCH_MED_MGMT/);
    assert.match(formats, /PRIMARY_CARE_SOAP/);
    assert.match(formats, /Template cues/);
    assert.match(formats, /You complete/);
    assert.match(formats, /Dismiss scribe/);
    assert.match(formats, /Stop and discard/);
    assert.match(formats, /NEVER_AI_HEADINGS/);
    assert.match(formats, /defaultScribeFormat/);
  });

  it('scribe API uses clinical guard', () => {
    assert.match(scribeApi, /guard:\s*'clinical'/);
    assert.match(scribeApi, /PSYCH_MED_MGMT/);
  });
});

describe('inbox-todo-cleanup-sud-measures', () => {
  const sud = read('src/lib/sud/measures.ts');
  const sudApi = read('src/app/api/ehr/scanner/sud-radar/measures/route.ts');
  const tasks = read('src/app/dashboard/tasks/page.tsx');
  const inbox = read('src/app/dashboard/inbox/page.tsx');

  it('SUD four measures + dialog labels + dedupe schedule', () => {
    assert.match(sud, /AUDIT \(alcohol use assessment\)/);
    assert.match(sud, /CAGE-AID/);
    assert.match(sud, /NIDA-Modified ASSIST/);
    assert.match(sud, /BAM — Brief Addiction Monitor/);
    assert.match(sud, /Assign substance-use measures/);
    assert.match(sud, /itemContentPending/);
    assert.match(sudApi, /SUD_MEASURES_ASSIGNED/);
    assert.match(sudApi, /scheduleModule/);
  });

  it('To-Do My patients only and Inbox groups', () => {
    assert.match(tasks, /My patients only/);
    assert.match(tasks, /All caught up/);
    assert.match(tasks, /Prior authorizations go to billing/);
    assert.match(inbox, /likely_inactive/);
    assert.match(inbox, /valant_import/);
    assert.match(inbox, /all_documents/);
    assert.match(inbox, /Discharge review/);
  });
});

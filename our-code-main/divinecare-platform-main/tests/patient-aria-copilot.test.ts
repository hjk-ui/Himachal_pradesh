import test from 'node:test';
import assert from 'node:assert/strict';
import { POST, OPTIONS } from '../src/app/api/patient/aria/route';

test('Aria Patient Copilot (AWS Bedrock) Endpoint Suite', async (t) => {
  await t.test('1. OPTIONS preflight returns CORS headers for Flutter app', async () => {
    const res = OPTIONS();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.ok(res.headers.get('Access-Control-Allow-Methods')?.includes('POST'));
  });

  await t.test('2. Regular wellness prompt returns supportive reply & suggested exercise', async () => {
    const req = new Request('http://localhost:3000/api/patient/aria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'I have been feeling quite anxious and overwhelmed today with work.',
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const json = await res.json();

    assert.equal(json.success, true);
    assert.equal(json.crisisDetected, false);
    assert.ok(typeof json.message === 'string' && json.message.length > 0);
    assert.ok(json.reply?.summary);
    assert.ok(json.reply?.encouragement);
    assert.ok(json.reply?.suggested_exercise?.title);
    assert.ok(Array.isArray(json.reply?.suggested_exercise?.steps));
  });

  await t.test('3. Crisis intent triggers 988 Lifeline Safety Interceptor', async () => {
    const req = new Request('http://localhost:3000/api/patient/aria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'I feel like I want to die and kill myself',
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const json = await res.json();

    assert.equal(json.success, true);
    assert.equal(json.crisisDetected, true);
    assert.ok(json.escalation?.hotline.includes('988'));
    assert.ok(json.message.includes('988'));
    assert.ok(json.reply?.suggested_exercise?.title.includes('Safety'));
  });

  await t.test('4. Empty message returns validation 400', async () => {
    const req = new Request('http://localhost:3000/api/patient/aria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '',
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.success, false);
  });
});

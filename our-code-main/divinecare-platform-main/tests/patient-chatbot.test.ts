import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import { PatientAppError } from '../src/patient/domain';

test('Patient AI Chatbot (AWS Bedrock) Endpoint Suite', async (t) => {
  let bedrockConfigured = true;
  let bedrockThrows = false;
  let bedrockReply: string = 'You can check your scheduled visits in the Schedule tab.';
  let lastBedrockCall: any = null;

  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;

  loader._load = function (id, ...args) {
    if (id === '@/patient/application/auth/session') {
      return {
        requirePatient: async (req: Request) => {
          const auth = req.headers.get('authorization');
          if (!auth || !auth.startsWith('Bearer valid-patient-token')) {
            throw new PatientAppError('Sign in required', 401, 'unauthenticated');
          }
          return {
            accountId: 'acc-synthetic-1',
            clientId: 'client-synthetic-1',
            name: 'Synthetic Patient',
            email: 'patient@example.test',
            phone: '+14105550100',
            status: 'ACTIVE',
          };
        },
      };
    }
    if (id === '@/lib/ai/bedrockService') {
      return {
        isBedrockConfigured: () => bedrockConfigured,
        invokeBedrock: async (opts: any) => {
          lastBedrockCall = opts;
          if (bedrockThrows) {
            throw new Error('AWS Bedrock invocation failure: connection timeout');
          }
          return bedrockReply;
        },
        BEDROCK_MODELS: {
          HAIKU: 'anthropic.claude-3-haiku-20240307-v1:0',
          SONNET: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        },
      };
    }
    return originalLoad.call(this, id, ...args);
  };

  const require = createRequire(import.meta.url);
  let chatbotRoute: typeof import('../src/app/api/patient/chatbot/route');

  try {
    chatbotRoute = require('../src/app/api/patient/chatbot/route');
  } finally {
    loader._load = originalLoad;
  }

  let ipCounter = 0;
  const makeRequest = (
    body: unknown,
    options: { authenticated?: boolean; ip?: string } = {}
  ) => {
    const { authenticated = true, ip = `chatbot-test-ip-${++ipCounter}` } = options;
    return new Request('https://example.test/api/patient/chatbot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ip,
        ...(authenticated ? { Authorization: 'Bearer valid-patient-token' } : {}),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  };

  await t.test('1. OPTIONS preflight returns CORS headers for mobile Flutter app', async () => {
    const res = chatbotRoute.OPTIONS();
    assert.equal(res.status, 204);
    assert.ok(res.headers.get('Access-Control-Allow-Origin'));
    assert.ok(res.headers.get('Access-Control-Allow-Methods')?.includes('POST'));
    assert.ok(res.headers.get('Access-Control-Allow-Headers')?.includes('Authorization'));
  });

  await t.test('2. Unauthenticated request is rejected with HTTP 401', async () => {
    const req = makeRequest(
      { messages: [{ role: 'user', content: 'Where are my appointments?' }] },
      { authenticated: false }
    );
    const res = await chatbotRoute.POST(req);
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'unauthenticated');
    assert.equal(json.error.message, 'Sign in required');
  });

  await t.test('3. Invalid inputs return HTTP 400 validation error', async (t2) => {
    await t2.test('empty messages array fails validation', async () => {
      const res = await chatbotRoute.POST(makeRequest({ messages: [] }));
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.error.code, 'VALIDATION_ERROR');
    });

    await t2.test('last message must be from user, not assistant', async () => {
      const res = await chatbotRoute.POST(
        makeRequest({
          messages: [
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'How can I assist you today?' },
          ],
        })
      );
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.error.code, 'VALIDATION_ERROR');
      assert.equal(json.error.message, 'A user message is required.');
    });

    await t2.test('whitespace only content fails validation', async () => {
      const res = await chatbotRoute.POST(
        makeRequest({ messages: [{ role: 'user', content: '     ' }] })
      );
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.error.code, 'VALIDATION_ERROR');
    });

    await t2.test('more than 12 messages fails validation', async () => {
      const msgs = Array.from({ length: 13 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));
      // ensure last is user
      msgs[12] = { role: 'user', content: 'Last message' };
      const res = await chatbotRoute.POST(makeRequest({ messages: msgs }));
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.error.code, 'VALIDATION_ERROR');
    });

    await t2.test('message exceeding 1,000 characters fails validation', async () => {
      const res = await chatbotRoute.POST(
        makeRequest({ messages: [{ role: 'user', content: 'A'.repeat(1001) }] })
      );
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.error.code, 'VALIDATION_ERROR');
    });
  });

  await t.test('4. Bedrock unconfigured returns HTTP 503 AI_UNAVAILABLE (no fake demo fallback)', async () => {
    bedrockConfigured = false;
    bedrockThrows = false;
    try {
      const res = await chatbotRoute.POST(
        makeRequest({ messages: [{ role: 'user', content: 'Can I reschedule my visit?' }] })
      );
      assert.equal(res.status, 503);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.error.code, 'AI_UNAVAILABLE');
      assert.equal(json.error.message, 'The AI assistant is not configured.');
      // Must not return data.reply
      assert.equal(json.data, undefined);
    } finally {
      bedrockConfigured = true;
    }
  });

  await t.test('5. Bedrock runtime exception returns HTTP 503 AI_UNAVAILABLE', async () => {
    bedrockConfigured = true;
    bedrockThrows = true;
    try {
      const res = await chatbotRoute.POST(
        makeRequest({ messages: [{ role: 'user', content: 'How do I join telehealth?' }] })
      );
      assert.equal(res.status, 503);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.error.code, 'AI_UNAVAILABLE');
      assert.equal(json.error.message, 'The AI assistant is temporarily unavailable.');
      assert.equal(json.data, undefined);
    } finally {
      bedrockThrows = false;
    }
  });

  await t.test('6. Empty or blank Bedrock reply returns HTTP 503 AI_UNAVAILABLE', async () => {
    bedrockConfigured = true;
    bedrockThrows = false;
    const oldReply = bedrockReply;
    try {
      bedrockReply = '   ';
      const res = await chatbotRoute.POST(
        makeRequest({ messages: [{ role: 'user', content: 'Help please' }] })
      );
      assert.equal(res.status, 503);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.error.code, 'AI_UNAVAILABLE');
      assert.equal(json.error.message, 'Please try again.');
      assert.equal(json.data, undefined);
    } finally {
      bedrockReply = oldReply;
    }
  });

  await t.test('7. Successful invocation calls Bedrock HAIKU and returns Flutter contract', async () => {
    bedrockConfigured = true;
    bedrockThrows = false;
    bedrockReply = 'Your upcoming visits are listed on the Home and Schedule screens.';
    lastBedrockCall = null;

    const res = await chatbotRoute.POST(
      makeRequest({
        messages: [
          // Simulate an initial assistant greeting from UI history
          { role: 'assistant', content: 'Hello! I am Altrixs Help.' },
          { role: 'user', content: 'Where do I find my doctor appointments?' },
        ],
      })
    );

    assert.equal(res.status, 200);
    const json = await res.json();

    // Verify Flutter contract: { success: true, data: { reply: string } }
    assert.equal(json.success, true);
    assert.ok(json.data);
    assert.equal(json.data.reply, 'Your upcoming visits are listed on the Home and Schedule screens.');

    // Verify Bedrock invocation parameters
    assert.ok(lastBedrockCall);
    assert.equal(lastBedrockCall.model, 'HAIKU');
    assert.equal(lastBedrockCall.maxTokens, 600);
    assert.equal(lastBedrockCall.temperature, 0.2);
    assert.ok(lastBedrockCall.system.includes('Altrixs Help'));

    // Anthropic Bedrock constraint: must start with user turn
    assert.equal(lastBedrockCall.messages[0].role, 'user');
    assert.equal(lastBedrockCall.messages[0].content, 'Where do I find my doctor appointments?');
  });

  await t.test('8. Rate limiting enforces max 20 requests per IP per 15 minutes', async () => {
    bedrockConfigured = true;
    bedrockThrows = false;
    const rateLimitIp = `rate-limit-test-ip-${Date.now()}`;

    // Send 20 allowed requests
    for (let i = 0; i < 20; i++) {
      const res = await chatbotRoute.POST(
        makeRequest(
          { messages: [{ role: 'user', content: `Request #${i}` }] },
          { ip: rateLimitIp }
        )
      );
      assert.equal(res.status, 200, `Request ${i} should succeed`);
    }

    // 21st request from same IP must be rejected with 429
    const blockedRes = await chatbotRoute.POST(
      makeRequest(
        { messages: [{ role: 'user', content: 'One too many' }] },
        { ip: rateLimitIp }
      )
    );
    assert.equal(blockedRes.status, 429);
    const json = await blockedRes.json();
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'RATE_LIMITED');
  });
});

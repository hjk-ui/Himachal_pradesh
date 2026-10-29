# Patient AI chatbot

The Flutter app calls authenticated `POST /api/patient/chatbot`. The backend forwards submitted chat messages to AWS Bedrock running Anthropic Claude 3 Haiku via `src/lib/ai/bedrockService.ts`; it does not load patient records. Requests are limited to 20 per IP per 15 minutes and 12 messages of 1,000 characters each.

The integration reuses the existing server-side AWS credentials:

- `AWS_ACCESS_KEY_ID`: AWS IAM access key with `bedrock:InvokeModel` permissions.
- `AWS_SECRET_ACCESS_KEY`: AWS IAM secret key.
- `AWS_REGION`: AWS region where Bedrock is deployed (defaults to `us-east-1`).
- `BEDROCK_CLAUDE_HAIKU_MODEL_ID`: optional model ID override; defaults to `anthropic.claude-3-haiku-20240307-v1:0`.

Never expose AWS credentials in Flutter or client-facing code.

Deploy the backend route before releasing the Flutter client. If Bedrock credentials are missing or the invocation fails, the route returns an explicit HTTP 503 `AI_UNAVAILABLE` error; it never returns mock or fallback text as a successful live AI response. The Flutter client displays an unavailable message. Signed-out screens show the button, but AI requests require an active authenticated patient session. Chat history is memory-only and resets when the signed-in user changes.

Before enabling for patients, ensure the app privacy disclosures describe the AI provider and user-submitted messages. The assistant provides app guidance, cannot take account actions, and is not a clinician.

Validation: Automated tests mock AWS Bedrock and verify authentication rejection, input validation, unconfigured/error handling (503), and successful reply contract (`{ success: true, data: { reply: string } }`).


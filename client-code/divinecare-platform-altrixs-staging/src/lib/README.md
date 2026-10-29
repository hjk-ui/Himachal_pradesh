# `lib/` — Next.js server helpers

Auth, Prisma, mail, and domain logic used by `app/api` route handlers.

## Allowed imports

- `lib` → `@/types` | prisma/db/mail/platform helpers only
- **Never** import from `@/features` (avoids server ↔ client cycles)

Browser-safe files that features may import: `api-client`, `config`, `mocks/*`, `auth/roleAccess`, `auth/roles`.

Do not import server-only modules from Client Components unless the file is explicitly safe for the browser.

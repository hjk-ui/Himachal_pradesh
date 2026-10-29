# `features/` — feature slices

Each feature owns UI, hooks, and client-side API calls for one area
(auth, staff, dashboard, …). Pages in `app/` stay thin and import from here.

## Allowed imports

- `app` → `features` | `components` | `lib`
- `features` → `@/types` + browser-safe `lib` (`api-client`, `config`, `mocks`, `auth/roleAccess`, `auth/roles`)
- Prefer barrels: `@/features/<name>` over deep paths when possible

Do **not** put server-only Prisma / NextAuth config under `features/`.

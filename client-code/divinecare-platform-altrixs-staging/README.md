# Altrixs Web

Next.js staff portal — PostgreSQL + NextAuth.

```
src/app/           # routes + API
src/components/
src/features/
src/lib/
prisma/
```

## Local

```bash
npm install
cp .env.example .env
# set DATABASE_URL, AUTH_SECRET, AUTH_URL
# EMPTY local database only: create the Prisma tables, then the SQL-only migrations.
# Never run `prisma db push` against staging or production: it drops SQL-only columns.
npx prisma db push
npm run db:migrate
npm run db:seed
# optional platform operator:
PLATFORM_ADMIN_EMAIL=you@altrixs.com PLATFORM_ADMIN_PASSWORD='StrongPass123' npm run db:create-platform-admin
npm run dev
```

| Who | URL | Notes |
|-----|-----|--------|
| Clinic staff | `/dashboard` | Scoped to their organization |
| Super Admin | `/platform` | All orgs + users |

Seed clinic logins: `admin@altrixs.local` / `Altrixs@123`

## Production (`https://altrixs.com`)

Deploy on **AWS EC2** (+ RDS Postgres). See [DEPLOY.md](./DEPLOY.md).

Required env: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL=https://altrixs.com`, SMTP vars.

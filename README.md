# Hospital Vercel Postgres Deployment

Use this folder as the Vercel project root when deploying with a hosted Postgres database.

## 1. Create the database

In Vercel, add a Postgres provider from Marketplace, for example Neon. Vercel will inject `DATABASE_URL` or `POSTGRES_URL` into the project environment.

If you already have a Postgres database, add its connection string manually in Vercel:

```text
Project Settings -> Environment Variables -> DATABASE_URL
```

Use the provider connection string, not `localhost`. It usually looks like:

```text
postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

## 2. Import the migrated data

Run these files against the Postgres database in order:

```text
sql/001_schema.sql
sql/002_seed.sql
```

You can paste them into the provider SQL editor, or run them with `psql` using your database connection string.

## 3. Deploy

Upload/import the whole `hospital-vercel-postgres` folder as the Vercel project root.

Vercel settings:

- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`

After deploy, test:

```text
https://YOUR-APP.vercel.app/api/health
https://YOUR-APP.vercel.app/api/dashboard
https://YOUR-APP.vercel.app/api/maestra
```

This version uses Postgres at runtime, not SQLite.

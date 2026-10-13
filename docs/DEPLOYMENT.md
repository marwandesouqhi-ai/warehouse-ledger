# Deployment Guide

## Local development
1. Create a `.env.local` file from `.env.example` and provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
2. Run `npm install`.
3. Run `npm run dev`.

## Vercel
1. Import the repository into Vercel.
2. Set the root directory to the repo root.
3. Add environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Deploy with the default Vite build.

## Supabase
1. Create a new project in Supabase.
2. Apply the migrations under `supabase/migrations/` using the Supabase CLI or SQL Editor.
3. In Supabase Auth settings, enable email/password sign-up and configure the site's allowed redirect URLs.
4. Ensure the `public` schema is exposed to the Data API; the migration grants table access only to authenticated users and applies owner-based RLS.

## Production notes
- The publishable key is intended for browser use; database access is restricted by Auth and RLS.
- Never expose a secret or service-role key in browser builds, logs, or client bundles.
- Validate the security headers in `vercel.json` after the final production deployment.

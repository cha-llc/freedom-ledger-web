# Freedom Ledger Web

Personal finance web app. CSV/PDF parsing for Capital One, Chase, Amex, Discover. Multi-account budget tracking.

**Live:** [freedom-ledger.vercel.app](https://freedom-ledger.vercel.app)

## Stack
- Next.js 15 + React 19
- Supabase (Auth + DB + Edge Functions)
- TypeScript (strict)
- Deployed on Vercel

## Development

```bash
cp .env.example .env.local
# Fill in .env.local with your values

npm install
npm run dev
```

## CI/CD
- GitHub Actions: typecheck + lint + build on every push
- Supabase migrations auto-deployed on push to main
- Vercel auto-deploys from main branch

## Organization
C.H.A. LLC · [cjhadisa.com](https://cjhadisa.com)

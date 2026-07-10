# CLAUDE.md — BuildingHub

Guidance for Claude Code working in this repo. **Read the two docs below before making changes.**

## Read first
- **[docs/HANDOFF.md](docs/HANDOFF.md)** — what the app is, what changed, migrations list, ops, known gaps, next steps. **Start here.**
- **[docs/WORKFLOW.md](docs/WORKFLOW.md)** — the domain model and the reasoning behind every design decision (orgs/grants, compounds/blocks, allocation, dues, permissions).

## What this is
Multi-tenant building-management app for Lebanon. **React 19 + TypeScript + Vite + Tailwind v4**, i18n (en/ar, RTL), backed by **Supabase** (Postgres + Auth + Storage + Edge Functions). Email via a Supabase Edge Function (`dynamic-action`) → Resend, triggered by Database Webhooks.

## Run / verify
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build — MUST pass before committing
npm run lint     # oxlint — warnings ok, no errors
```
Requires `.env.local` (gitignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (shared Supabase project).

## Non-negotiables / conventions
- **Security is in the database.** Every table uses RLS routed through the SQL function `user_can(building, capability)`. Client checks (`useAuth().can(...)`, `src/lib/permissions.ts`) are for UI gating only — never the source of truth. Keep `role_has_cap()` (SQL) and `permissions.ts` (TS) in sync.
- **Identity ≠ management ≠ residency.** One login per person. Management access = `grants` (role on a building or org). Residency = `memberships` (user owns a unit). A person can be both. Platform admin = `profiles.is_platform_admin` (the operator; god-mode).
- **Migrations are additive & idempotent** (`IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`). They live in `supabase/migrations/NNNN_*.sql` and are applied by hand in the Supabase SQL Editor (there's no automated migration runner). Never write destructive migrations.
- **Charges carry the block.** A `charge` has `unit_id` AND `building_id` (the unit's block), so the compound book and per-block slice both derive from charges. A unit's balance is identical at compound or block level.
- **Compound vs block.** A "building" row = a block; blocks share a `compound_id`. Finance/inspections/contracts can target a whole compound or one block. Use the shared `useEntities()` (`src/lib/entities.ts`) for the compound/standalone selector.
- **Billing mode** per building/compound: `arrears` (pay actual balance) or `dues` (fixed prepayments). Default `arrears` — don't change existing behavior.
- **Notifications = two channels.** In-app 🔔 (DB triggers, migrations `0009/0011/0012/0015`) and email (edge function `dynamic-action` + Database Webhooks). Same event → one of each; don't double up within a channel.
- **Storage:** one public bucket `attachments` (migration `0005`). Use `src/lib/upload.ts`.
- **Money is USD only** for now. `amount_usd` everywhere.
- **i18n:** user-facing strings go through `t()` with keys in `src/i18n/en.json` + `ar.json`. Arabic falls back to English if a key is missing.

## Repo / workflow
- Main repo is `jihadmeraachli/BuildingHub` (private), branch `master`. Both Jey and Ahmad push directly. **Pull before starting**, push when done.
- **Never commit** `.env.local` or real Supabase keys. The `anon` key is public-safe; the **secret** key must never be committed.
- Edge function changes require redeploy via Supabase dashboard editor (Functions → dynamic-action → Deploy). The relevant Database Webhook must exist for it to fire.
- **GitHub Projects board:** `github.com/jihadmeraachli/BuildingHub` → Projects → BuildingHub Roadmap. 41 issues across Todo / In Progress / Done. Move cards as features are completed.
- **Two Claude instances** (one per developer) stay in sync via this CLAUDE.md + docs/HANDOFF.md + docs/WORKFLOW.md — all committed to the repo. Update these docs when adding features or making architectural decisions.

## Directory map
- `src/pages` — one file per route (Dashboard, Finance, Dues, Structure, Inspections, Contracts, Issues, Meetings, Buildings, Users, Login/Register).
- `src/components/ui` — shared UI (Card, Button, Input, Select, Badge, Modal, Charts).
- `src/lib` — supabase client, permissions, upload, `useManagedBuildings`/`useViewableBuildings`/`useEntities`.
- `src/contexts/AuthContext.tsx` — session + grants + memberships + `can()`.
- `supabase/migrations` — SQL migrations. `supabase/functions/dynamic-action` — email edge function.

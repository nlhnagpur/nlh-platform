# NLH Platform — Project Context

## About
New Learning Horizons (NLH) — ISO 9001:2015 certified education franchise platform.
Founded 2008, Nagpur, Maharashtra. 16 skill-based courses, ages 2–21.

## Architecture
- **Frontend**: React 18 + Vite SPA, 35 files under `src/` (pages/components/context) —
  the old single-file `index.html` vanilla-JS build has been fully replaced.
  Routing is mostly hand-rolled through `AuthContext`'s `screen` state and
  `Sidebar`'s active-page id, not URL-addressable routes.
- **Serverless API**: `api/*.js` — Vercel functions for anything needing a secret
  key or server-side work (create-user, send-email, WhatsApp sends, Razorpay).
  Everything else talks to Supabase directly from the browser (anon key + RLS).
- **Database**: Supabase PostgreSQL (project: frnnoxudtlvhyyoqdqzx, Mumbai region)
- **Auth**: Supabase Auth with JWT
- **Email**: Brevo API (transactional) + Brevo SMTP (password reset via Supabase)
- **Hosting**: Vercel (frontend + `api/`) at nlh-platform.vercel.app
- **PDF**: jsPDF (franchise agreements) + `InvoiceView.jsx`'s own print/PDF flow
  for orders (a separate, older jsPDF-based invoice generator existed in
  OrdersPage.jsx but was dead code — never wired to any button — and was removed)

## Database Connection
- URL: https://frnnoxudtlvhyyoqdqzx.supabase.co
- Anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZybm5veHVkdGx2aHl5b3FkcXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNTY2NDUsImV4cCI6MjA5MjkzMjY0NX0.1OuqWuV-X09wEzWMp9_zjNRbWNDcSvR4TgYmu0373zE

## Migrations — keep the repo in sync
Every migration applied to the hosted DB (via `apply_migration` or the dashboard)
MUST also land in `nlh-platform/supabase/migrations/` or the repo drifts and the
schema can't be rebuilt. When YOU apply a migration, in the same turn write the
file `supabase/migrations/<version>_<name>.sql` using the version the DB assigned
(`select version from supabase_migrations.schema_migrations order by version desc limit 1`).
For a bulk catch-up (e.g. SQL applied outside a session), run `npm run db:sync`
in nlh-platform — it pulls the true history via the service-role `export_migrations()`
RPC (needs `SUPABASE_SERVICE_KEY` in `.env.local`). A PostToolUse hook also runs
db:sync automatically after each apply_migration on the owner's machine.

## Email (Brevo)
- API key is server-only: `process.env.BREVO_KEY`, read in `api/send-email.js`
  (a Vercel function). Not present anywhere in the client bundle — checked by
  grepping the actual key value across the repo, no matches.
- SMTP: smtp-relay.brevo.com:587 / aa0d69001@smtp-brevo.com
- Sender: admin@nlhnagpur.info / New Learning Horizons

## 10 User Roles (5 admin + 5 operational)
Admin hierarchy: owner → super_admin → admin → manager → staff
Franchise hierarchy: NLH → SMF (State) → CF (City) → UF (Unit) → Student
All admin roles use `isAdminRole(currentRole)` check.

## Admin Team
- Dhiral Panchmatia — OWNER (dhiral@nlhnagpur.info / 9373111311)
- Rasesh Panchmatia — SUPER ADMIN (rasesh@nlhnagpur.info / 9028006800)
- Shivank Panchmatia — ADMIN (shivank@nlhnagpur.info / 8669021866)
- nlhnagpur@gmail.com — MANAGER (8087258253)

## Key Database Tables
- `users` — email, role, franchisee_id (case-insensitive lookup with .ilike())
- `franchisees` — self-referencing parent_id tree, tier (SMF/CF/UF), registered_courses, registered_skus, fee_paid
- `courses` — 16 programs, group_name
- `skus` — 57 level-wise SKUs, uf_rate, cf_rate, smf_rate, student_fee
- `students` — fee_total, fee_paid, payment_status
- `orders` — status (pending/invoiced/closed), amount_paid, placer_id, supplier
- `order_items` — ordered_qty, sent_qty, rate
- `enrollments` — student_id, sku_id, franchisee_id

## Critical Business Rules
1. Territory: Only 1 SMF per state, 1 CF per city, multiple UFs per city
2. UF can only order SKUs for admin-enabled levels (registered_skus)
3. Each tier sees only their own stock/orders/students (hierarchy filtered)
4. Revenue split: CF 50%/SMF 25%/NLH 25% (not yet implemented in code)
5. Invoice numbers sequential: INV-YYYY-XXXX (atomic update with .is('invoice_no', null))
6. Kit price changes logged in kit_price_history (non-destructive)
7. Order lifecycle: pending → invoiced → payment_submitted → verified → closed
8. Dispatch is independent of payment (credit allowed)
9. Email lookup MUST use .ilike() for case-insensitive matching

## Order Flow
1. Franchisee places order → status: pending → confirmation email sent
2. Admin generates invoice → status: invoiced → invoice email sent
3. Franchisee submits payment proof (mode + UTR) → payment_submitted_at set
4. Admin verifies payment → status: closed (or part_paid stays invoiced)
5. Dispatch with AWB can happen anytime independently

## Coding Conventions
- All functions are plain `function` or `async function` (no arrow functions) —
  this carried over from the old vanilla-JS build and is still followed in React
- Event handling is normal React (`onClick={...}` etc.) — the old build's
  `document.addEventListener('click', ...)` + data-* delegation pattern is gone
- UI uses CSS custom properties (--purple, --green, --text, --border etc.)
- Primary color: #534AB7 (purple)
- Font: DM Sans (UI), DM Mono (data/codes)
- Amounts stored as integers (whole rupees)
- All email lookups case-insensitive (.ilike())
- sb.auth.signUp must be followed by session restore (admin session fix)

## Known Issues / Pending
- Revenue split engine not implemented (`revenue_splits` table exists, unused)
- sb.auth.signUp workaround for admin session — `/api/create-user.js` now exists
  specifically to avoid this; confirm no remaining direct client-side `signUp()`
  calls before assuming it's fully retired everywhere
- No stock/inventory tracking per franchisee yet (HO-level only)
- The multi-file React migration and WhatsApp integration (both previously listed
  here as pending) are done — see Architecture above and the WhatsApp Inbox page

## Future Architecture (from tech brief)
- Frontend: React.js + Vite + Tailwind CSS
- Backend: Node.js + Fastify
- Database: PostgreSQL (keep Supabase)
- Background jobs: BullMQ + Redis
- Payments: Razorpay
- WhatsApp: Twilio/WATI
- Mobile: React Native

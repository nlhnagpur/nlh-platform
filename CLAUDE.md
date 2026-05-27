# NLH Platform — Project Context

## About
New Learning Horizons (NLH) — ISO 9001:2015 certified education franchise platform.
Founded 2008, Nagpur, Maharashtra. 16 skill-based courses, ages 2–21.

## Architecture
- **Single-file SPA**: Everything is in `index.html` (~660KB)
- **Frontend**: Vanilla JS + CSS (no React/build tools yet)
- **Database**: Supabase PostgreSQL (project: frnnoxudtlvhyyoqdqzx, Mumbai region)
- **Auth**: Supabase Auth with JWT
- **Email**: Brevo API (transactional) + Brevo SMTP (password reset via Supabase)
- **Hosting**: Vercel (frontend) at nlh-platform.vercel.app
- **PDF**: jsPDF for invoice generation

## Database Connection
- URL: https://frnnoxudtlvhyyoqdqzx.supabase.co
- Anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZybm5veHVkdGx2aHl5b3FkcXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNTY2NDUsImV4cCI6MjA5MjkzMjY0NX0.1OuqWuV-X09wEzWMp9_zjNRbWNDcSvR4TgYmu0373zE

## Email (Brevo)
- API key in index.html (var BREVO_KEY)
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
- All functions are plain `function` or `async function` (no arrow functions)
- Event delegation via `document.addEventListener('click', ...)` with data-* attributes
- UI uses CSS custom properties (--purple, --green, --text, --border etc.)
- Primary color: #534AB7 (purple)
- Font: DM Sans (UI), DM Mono (data/codes)
- Amounts stored as integers (whole rupees)
- All email lookups case-insensitive (.ilike())
- sb.auth.signUp must be followed by session restore (admin session fix)

## Known Issues / Pending
- Revenue split engine not implemented
- Should migrate to multi-file architecture (React + Node.js backend)
- Brevo API key exposed in frontend (move to backend)
- sb.auth.signUp workaround for admin session (needs Supabase Admin API)
- No stock/inventory tracking per franchisee yet
- No WhatsApp integration yet

## Future Architecture (from tech brief)
- Frontend: React.js + Vite + Tailwind CSS
- Backend: Node.js + Fastify
- Database: PostgreSQL (keep Supabase)
- Background jobs: BullMQ + Redis
- Payments: Razorpay
- WhatsApp: Twilio/WATI
- Mobile: React Native

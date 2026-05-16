# NLH Platform — Development Checkpoint
_Last updated: 2026-05-16_

---

## 1. Franchise Hierarchy

```
NLH Head Office (Nagpur)
 └── SMF — State Master Franchisee  (1 per Indian state, 1 per foreign country)
      └── CF — City Franchisee       (1 per city within the SMF's territory)
           └── UF — Unit Franchisee  (multiple per city, each in their own area)
                └── Students
```

### Territory Rules (enforced in code)
| Tier | Uniqueness rule | Country-aware? |
|------|-----------------|----------------|
| SMF  | 1 per Indian state; 1 per foreign country | Yes |
| CF   | 1 per city (matched on country + city) | Yes |
| UF   | No uniqueness limit; multiple per city | — |

### Parent Assignment
- **SMF** → no parent (parent_id = null)
- **CF** → must have a parent SMF
- **UF** → preferred parent is CF; fallback to SMF; fallback to NLH HO

Parent picker for UF shows all CFs + all SMFs + NLH HO with `[TIER]` prefix so admin can pick the appropriate level. Enforced in both **AddFranchiseeModal** (admin) and **OnboardingPage** (self-registration).

---

## 2. User Roles & Access

### Admin roles (5) — use `isAdminRole()` check
| Role | Access |
|------|--------|
| owner | Full access, all pages |
| super_admin | Full access, all pages |
| admin | Full access, all pages |
| manager | Full access, all pages |
| staff | Full access, all pages |

### Operational roles (5)
| Role | DB value | Access |
|------|----------|--------|
| SMF | `smf` | Own tree: self + CF children + UF grandchildren + their students |
| CF | `cf` | Own tree: self + UF children + their students |
| UF | `uf` | Own centre only: own orders, own students |
| Student | `student` | Own profile only |
| (Unlinked) | `student` | → Onboarding page |

### Key rule: hierarchy-filtered views
- **Franchisees page**: SMF/CF see descendants only; admin sees all
- **Students page**: UF sees own students; SMF/CF sees full tree; admin sees all
- **Orders page**: Same hierarchy pattern
- **Centre picker for students**: Admin/master sees NLH HO pinned + city-filtered locals; UF sees own centre only

---

## 3. Address Structure (5 fields — all entities)

```
country   → India (default), or international
state     → Maharashtra (required for Indian SMF)
city      → Nagpur (required for CF; drives centre picker for students)
area      → Sadar, Dharampeth… (sub-locality)
address   → Street / building / shop no. (free-text)
```

Used in: `franchisees`, `students` tables.

### Address-driven centre picker
When adding a student, the **City** field in the address section automatically filters the centre picker — no separate country/city selector. Pattern:
1. NLH Head Office always pinned at top (clickable card)
2. If city is blank → hint: "Fill in City to see local centres"
3. If city has local centres → dropdown of matching UF/CF/SMF
4. If city has no centres → "No centres in [city] — enrol at NLH HO"

This pattern is implemented in both **AddStudentModal** (admin) and **OnboardingPage** (self-registration).

---

## 4. Order Lifecycle

```
pending → invoiced → payment_submitted → verified → closed
                         ↑                                    
              (franchisee submits UTR)                         
```

- **Dispatch** (AWB) can happen at any stage — independent of payment
- **Invoice number** format: `INV-YYYY-XXXX` — atomic assignment via `.is('invoice_no', null)` guard
- **Part payment**: status stays `invoiced` but `amount_paid` is set; badge shows `part_paid`

### Email triggers
| Event | Template |
|-------|----------|
| Order placed | `sendOrderConfirmation()` |
| Invoice generated | `sendInvoiceEmail()` + toolbar "📧 Send Email" button in InvoiceView |
| Payment reminder | `sendPaymentReminder()` |
| Payment verified | `sendPaymentVerified()` |
| Franchisee created | `sendWelcomeEmail()` (with temp password) |
| Admin user invited | `sendInviteEmail()` |

---

## 5. Kit / SKU Filter Logic (`deriveFilter`)

For student enrolment, available courses depend on the centre's registration:

```js
function deriveFilter(fr) {
  if (!fr) return null                  // no centre selected
  if (registered_skus.length > 0)       return { skuIds }      // SKU-level control (preferred)
  if (registered_courses.length > 0)    return { courseIds }   // course-level fallback
  if (fr.tier === 'UF')                 return { skuIds: [] }  // UF with nothing = blocked
  return 'all'                          // NLH / CF / SMF unrestricted
}
```

- **registered_skus** — granular (level-wise). Set directly in Supabase for now (no UI yet — see §8)
- **registered_courses** — course-level. Managed via Franchisee → Courses tab in UI
- **Priority**: `registered_skus` checked first; falls back to `registered_courses`

---

## 6. Auth & Account Creation Pattern

### Admin creates franchisee/user
```
1. INSERT franchisee row
2. sb.auth.getSession()  → save admin session
3. sb.auth.signUp()      → creates auth account with temp password
4. sb.auth.setSession()  → restore admin session (critical — signUp signs in new user)
5. sb.from('users').upsert() → create users row with role + franchisee_id
6. sendWelcomeEmail()    → temp password + login instructions
```

### Admin creates student
- Student login email: `student.{uuid}@nlhnagpur.info` (synthetic)
- Same admin session restore pattern
- `users` row: `role: 'student'`, `franchisee_id`, `student_id`

### Self-registration (OnboardingPage)
- Triggered when `role === 'student'` and no `student_id` / `franchisee_id`
- Franchisee: fills own details → inserts into `franchisees` + updates `users` row
- Student: fills own details → inserts into `students` + updates `users` row with `student_id`
- Territory duplicate checks run on SMF/CF self-registration (same rules as admin)

### Email lookup
**Always use `.ilike('email', value)`** — case-insensitive match everywhere.

---

## 7. Database — Key Tables

| Table | Key columns |
|-------|-------------|
| `franchisees` | `id, business_name, email, phone, tier, parent_id, status, country, state, city, area, address, registered_courses[], registered_skus[], enrollment_fee, fee_paid` |
| `users` | `id, email, role, franchisee_id, student_id, is_active` |
| `students` | `id, full_name, parent_name, dob, phone, franchisee_id, country, state, city, area, address, fee_total, fee_paid, payment_status, is_active` |
| `courses` | `id, name, group_name, is_active` |
| `skus` | `id, course_id, level_name, uf_rate, cf_rate, smf_rate, student_fee, sort_order` |
| `orders` | `id, placer_id, order_ref, invoice_no, status, amount_paid, payment_mode, payment_ref, payment_submitted_at, payment_verified_at, deliver_to, awb, supplier` |
| `order_items` | `order_id, sku_id, ordered_qty, sent_qty, rate` |
| `enrollments` | `student_id, sku_id, franchisee_id` |
| `kit_price_history` | Non-destructive log of all SKU price changes |

### Hierarchy utilities (`src/utils/hierarchy.js`)
- `getDescendantIds(id)` → IDs of all children (not self)
- `getTreeIds(id)` → IDs of self + all descendants

---

## 8. Known Gaps / Pending Features

| # | Gap | Priority |
|---|-----|----------|
| 1 | **registered_skus UI** — No admin UI to set SKU-level access for UF; must use Supabase directly | High |
| 2 | **Revenue split engine** — CF 50% / SMF 25% / NLH 25% not implemented | High |
| 3 | **Stock/inventory per franchisee** — No per-franchise inventory tracking | Medium |
| 4 | **International students / online classes** — Next major feature (HO-only enrolment, online flag) | Medium |
| 5 | **WhatsApp integration** — No WhatsApp notifications yet | Medium |
| 6 | **Razorpay integration** — Payment gateway not wired; manual UTR submission used | Medium |
| 7 | **Student enrolment during onboarding** — Self-registering students can pick centre but not courses | Low |
| 8 | **Parent display in FranchiseeDetailModal** — Parent name not shown in info tab | Low |
| 9 | **Brevo API key in frontend** — Should move to backend env | Security |
| 10 | **Multi-file architecture** — Should migrate to React + Node.js backend | Architecture |

---

## 9. Coding Conventions

- All functions: `function foo()` or `async function foo()` — no arrow functions
- Event handling: event delegation with `data-*` attributes where possible
- Amounts: stored as integers (whole rupees), formatted with `fmtAmt()`
- CSS: custom properties `--purple, --green, --red, --text, --border` etc.
- Primary: `#534AB7` (purple), Font: DM Sans (UI) + DM Mono (codes/numbers)
- Mobile tables: wrap in `<div className="tbl-scroll">` for horizontal scroll
- `.form-grid`: 2-column grid for forms; use `className="col-span-2"` for full-width rows

---

## 10. Infrastructure

| Service | Details |
|---------|---------|
| Frontend | Vercel → `nlh-platform.vercel.app` (auto-deploy from `main`) |
| Database | Supabase PostgreSQL — project `frnnoxudtlvhyyoqdqzx`, Mumbai |
| Auth | Supabase Auth + JWT |
| Email | Brevo API via `/api/send-email` Vercel serverless function |
| SMTP (password reset) | Brevo SMTP → smtp-relay.brevo.com:587 |
| PDF/Invoice | jsPDF in browser + InvoiceView print window |

### Environment variables
- `.env.local` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `BREVO_KEY`
- Vercel dashboard — same vars set for production

---

## 11. Completed Features (as of this checkpoint)

- [x] Login / logout / password reset (Supabase Auth + Brevo SMTP)
- [x] Role-based access for all 10 roles
- [x] Franchisee management: add, edit, courses tab, orders tab, students tab
- [x] UF parent cascade: CF → SMF → NLH HO fallback
- [x] Territory uniqueness check: Indian SMF (per state), international SMF (per country), CF (per city)
- [x] 5-field structured address: Country, State, City, Area, Street
- [x] International franchisee support
- [x] Student management: add with centre + course enrolment, edit, fee tracking
- [x] Address-driven centre picker (no separate filter tabs)
- [x] NLH HO always pinned at top in centre picker
- [x] deriveFilter: correct tier-aware SKU/course filtering (UF with nothing = blocked)
- [x] Order management: place, invoice, dispatch (AWB), payment submit, payment verify, close
- [x] Invoice PDF (jsPDF) + "📧 Send Email" button in toolbar
- [x] Kit prices page with edit history
- [x] Courses management
- [x] Users management (admin roles)
- [x] Access requests page
- [x] Mobile table scroll (.tbl-scroll on all tables)
- [x] Onboarding flow for self-registering franchisees and students
- [x] Welcome email with temp password for admin-created franchisees
- [x] Student auth account creation (`student.{id}@nlhnagpur.info`)
- [x] Email notifications: order confirmation, invoice, payment reminder, payment verified

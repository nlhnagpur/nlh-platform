// Keep supabase/migrations in sync with the hosted project's migration history.
//
// Migrations applied through the dashboard or an MCP tool land in the database
// but not in the repo, so the repo drifts. This pulls the true history — exact
// versions and content — and writes any missing or changed files.
//
// Reads the history through the public.export_migrations() function, which is
// granted to service_role ONLY (the migration SQL is the full schema and
// security model, so it must not be readable with the public anon key). Supply
// the service key via SUPABASE_SERVICE_KEY in the environment or in
// nlh-platform/.env.local. Without it the script is a no-op, so it is safe to
// wire into a hook that fires on machines where the key isn't configured.
//
//   node scripts/sync-migrations.mjs      (or: npm run db:sync)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT  = path.join(ROOT, 'supabase', 'migrations')
const URL  = 'https://frnnoxudtlvhyyoqdqzx.supabase.co/rest/v1/rpc/export_migrations'

// Service key from the environment, or from a gitignored .env.local
function serviceKey() {
  if (process.env.SUPABASE_SERVICE_KEY) return process.env.SUPABASE_SERVICE_KEY.trim()
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    const m = env.match(/^\s*SUPABASE_SERVICE_KEY\s*=\s*(.+?)\s*$/m)
    if (m) return m[1].replace(/^["']|["']$/g, '')
  } catch { /* no .env.local */ }
  return null
}

const key = serviceKey()
if (!key) {
  console.log('[sync-migrations] no SUPABASE_SERVICE_KEY — skipping (repo migrations left as-is).')
  console.log('[sync-migrations] to enable: add SUPABASE_SERVICE_KEY=... to nlh-platform/.env.local')
  process.exit(0)
}

const res = await fetch(URL, {
  method: 'POST',
  headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
  body: '{}',
})
if (!res.ok) {
  console.error('[sync-migrations] export failed:', res.status, (await res.text()).slice(0, 300))
  process.exit(1)
}
const rows = await res.json()

fs.mkdirSync(OUT, { recursive: true })
let written = 0
for (const m of rows) {
  const safe = String(m.name).replace(/[^a-z0-9_]/gi, '_').toLowerCase()
  const file = path.join(OUT, `${m.version}_${safe}.sql`)
  // Normalise the trailing ';;' the array join can produce, then only write on
  // a real change so unchanged files don't churn git.
  const body = m.sql.replace(/;\s*;\s*$/, ';\n')
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  if (prev !== body) { fs.writeFileSync(file, body, 'utf8'); written++ }
}

console.log(`[sync-migrations] ${rows.length} migrations on record · ${written} file(s) written/updated.`)

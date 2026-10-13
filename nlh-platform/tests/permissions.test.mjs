// Phase 1 regression baseline — application-side role / permission helpers.
// These only cover the CLIENT checks. They say nothing about RLS, which is the
// real enforcement layer (see docs/phase-1/security-permissions-audit.md).
import test from 'node:test'
import assert from 'node:assert/strict'

import { hasPerm, normalizePerms, PRESETS, DEFAULT_STAFF_PERMS, ACTION_PERMS, PAGE_PERMS } from '../src/constants/permissions.js'
import { isAdminRole, isManagerOrAbove } from '../src/constants/roles.js'

test('hasPerm: every non-staff role passes, staff need the ticked key', () => {
  for (const r of ['owner', 'super_admin', 'admin', 'manager', 'smf', 'cf', 'uf']) assert.equal(hasPerm(r, {}, 'orders.edit'), true)
  assert.equal(hasPerm('staff', { 'orders.edit': true }, 'orders.edit'), true)
  assert.equal(hasPerm('staff', {}, 'orders.edit'), false)
  assert.equal(hasPerm('staff', null, 'orders.edit'), false)
})

test('KNOWN BEHAVIOUR: hasPerm returns true for roles outside the list (student/school/unknown)', () => {
  // Client helper is permissive by design; the caller must gate by page/role
  // first. Recorded so the assumption is visible.
  assert.equal(hasPerm('student', {}, 'accounting.edit'), true)
  assert.equal(hasPerm('school', {}, 'accounting.edit'), true)
  assert.equal(hasPerm(undefined, {}, 'accounting.edit'), true)
})

test('normalizePerms: an action box without its page box is dropped', () => {
  const out = normalizePerms({ 'orders.edit': true, 'students.view': true })
  assert.equal(out['orders.edit'], undefined)
  assert.equal(out['students.view'], true)
})

test('normalizePerms: false values are removed, page+action kept', () => {
  const out = normalizePerms({ 'orders.view': true, 'orders.edit': true, 'orders.delete': false })
  assert.deepEqual(out, { 'orders.view': true, 'orders.edit': true })
})

test('every action permission depends on a page permission that is defined in PAGE_PERMS', () => {
  const pageKeys = new Set(PAGE_PERMS.map(p => p.key))
  const actions = ACTION_PERMS.flatMap(g => g.items)
  assert.ok(actions.length > 0)
  for (const a of actions) assert.ok(pageKeys.has(a.needs), a.key + ' needs undefined page key ' + a.needs)
})

test('presets never grant an action without its page', () => {
  for (const p of PRESETS) {
    const n = normalizePerms(p.perms)
    assert.deepEqual(Object.keys(n).sort(), Object.keys(p.perms).sort(), 'preset ' + p.id + ' contains an orphan action key')
  }
})

test('default staff permissions are view-only', () => {
  assert.ok(Object.keys(DEFAULT_STAFF_PERMS).every(k => k.endsWith('.view')))
})

test('isAdminRole / isManagerOrAbove', () => {
  for (const r of ['owner', 'super_admin', 'admin', 'manager', 'staff']) assert.equal(isAdminRole(r), true)
  for (const r of ['smf', 'cf', 'uf', 'student', 'school']) assert.equal(isAdminRole(r), false)
  assert.equal(isManagerOrAbove('manager'), true)
  assert.equal(isManagerOrAbove('staff'), false)
})

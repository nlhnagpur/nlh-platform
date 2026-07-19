// How many item lines fit on ONE A4 invoice page.
//
// The invoice is a fixed A4 sheet with a repeating header and footer, and it is
// also sent to the franchisee as a single WhatsApp image — so it must never
// spill onto a second page. These constants mirror the actual CSS in
// InvoiceView (both the on-screen sheet and its print paginator); if that
// layout changes, update them here.
//
// All values are CSS pixels at 96dpi.

const PX_PER_MM = 96 / 25.4
const PAGE_H    = Math.round(297 * PX_PER_MM)   // A4 height = 1123px

// ── Fixed chrome, top to bottom ──────────────────────────────────────────────
const MASTHEAD_H = 78    // yellow band: 10px padding + 68px logo row
const TAGLINE_H  = 20    // purple strip: 5+5 padding + ~10px text
const META_H     = 56    // 8+8 padding + label/value/status pill
const PARTIES_H  = 116   // From / Bill-to cards (min-height 104) + 12px wrapper
const SLACK      = 14    // rounding + sub-pixel safety
const FOOTER_H   = 38    // thank-you strip: 10+10 padding + ~18px text
const BODY_PAD   = 20    // .pbody vertical padding (10 top + 10 bottom)

const HEADER_H = MASTHEAD_H + TAGLINE_H + META_H + PARTIES_H + SLACK   // ≈ 284

// Space between the fixed header and fixed footer
export const ITEMS_AREA_H = PAGE_H - HEADER_H - FOOTER_H - BODY_PAD    // ≈ 781

// ── Inside the items box ─────────────────────────────────────────────────────
const BOX_BORDER  = 2    // 1px top + 1px bottom
const COL_HEAD_H  = 30   // purple column header: 9+9 padding + ~12px text

// Usable height for item rows themselves
export const ROWS_AREA_H = ITEMS_AREA_H - BOX_BORDER - COL_HEAD_H      // ≈ 749

// ── Row heights ──────────────────────────────────────────────────────────────
const ROW_BASE_H    = 35   // 9+9 padding + 16px name line + 1px border
const CHIP_LINE_H   = 20   // one line of kit chips (16px chip + 4px gap)
const CHIP_GAP      = 4    // margin above the first chip line
const CHIPS_PER_LINE = 3   // kit chips are wide; 3 per line is the safe case

/** Height of one item row, given how many kit chips it carries. */
export function rowHeight(kitCount) {
  const n = Number(kitCount) || 0
  if (n === 0) return ROW_BASE_H
  return ROW_BASE_H + CHIP_GAP + Math.ceil(n / CHIPS_PER_LINE) * CHIP_LINE_H
}

/**
 * Is the page full — i.e. is there no room for another item?
 * Uses a typical kit row as the yardstick, since the next item's kit isn't
 * known until it's picked.
 * @param {Array<{kitCount:number}>} items already on the invoice
 */
export function invoiceFull(items) {
  let used = 0
  ;(items || []).forEach(function (it) { used += rowHeight(it && it.kitCount) })
  return used + rowHeight(CHIPS_PER_LINE) > ROWS_AREA_H
}

/**
 * How many of these items fit on one page.
 * @param {Array<{kitCount:number}>} items in invoice order
 * @returns {{ fits:number, total:number, overflow:number }}
 */
export function invoiceFit(items) {
  const list = items || []
  let used = 0
  let fits = 0
  for (let i = 0; i < list.length; i++) {
    const h = rowHeight(list[i] && list[i].kitCount)
    if (used + h > ROWS_AREA_H) break
    used += h
    fits++
  }
  return { fits: fits, total: list.length, overflow: Math.max(0, list.length - fits) }
}

// Render a printable document (receipt / invoice) to a PNG and store it in the
// public chat-attachments bucket, so it can be sent as a WhatsApp image.
//
// Unlike the order invoice — which is already on screen and can be screenshotted
// in place (see captureInvoice.js) — receipts only exist as a self-contained
// HTML document destined for a print window. So we mount that document in an
// off-screen iframe, let it lay out with its own CSS, and capture from there.
// Using an iframe also keeps the document's global class names (.sheet, .body,
// .items …) from colliding with the app's own styles.

import html2canvas from 'html2canvas'
import { sb } from '../supabase'

// A4 width at 96dpi. The iframe must be at least this wide or the sheet is
// laid out in a narrower viewport and the capture comes out squashed.
const SHEET_W = 794

// NOTE: html2canvas renders its clone in the HOST document, so the webfonts
// must be loaded there — not just by the captured document's own <link>. That
// holds because index.html loads DM Sans and DM Mono; drop those and receipts
// silently capture in a serif fallback while still printing correctly.

function waitForLoad(iframe) {
  return new Promise(function (resolve) {
    const done = function () { resolve() }
    iframe.addEventListener('load', done, { once: true })
    // srcdoc on an already-parsed document can fire before the listener attaches
    setTimeout(done, 1500)
  })
}

async function waitForAssets(doc) {
  try { if (doc.fonts && doc.fonts.ready) await doc.fonts.ready } catch (e) { /* ignore */ }
  const imgs = Array.from(doc.images || [])
  await Promise.all(imgs.map(function (img) {
    if (img.complete) return Promise.resolve()
    return new Promise(function (resolve) {
      img.addEventListener('load', resolve, { once: true })
      img.addEventListener('error', resolve, { once: true })
      setTimeout(resolve, 3000)
    })
  }))
}

/**
 * @param {string} html  a complete document from studentDocs (ctx.asHtml)
 * @param {string} name  used for the stored filename, e.g. a receipt number
 * @returns {Promise<string|null>} public URL of the PNG, or null on failure
 */
export async function captureDocPng(html, name) {
  if (!html) return null

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText =
    'position:fixed;left:-10000px;top:0;border:0;width:' + SHEET_W + 'px;height:1200px;'
  document.body.appendChild(iframe)

  try {
    iframe.srcdoc = html
    await waitForLoad(iframe)

    const doc = iframe.contentDocument
    if (!doc) return null

    // The on-screen print button is not part of the document
    const bar = doc.querySelector('.np')
    if (bar) bar.remove()

    await waitForAssets(doc)

    const sheet = doc.querySelector('.sheet')
    if (!sheet) return null

    const canvas = await html2canvas(sheet, {
      scale: 2,                 // legible on a phone
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: SHEET_W,
      width: sheet.offsetWidth,
      height: sheet.offsetHeight,
    })

    const blob = await new Promise(function (resolve) {
      canvas.toBlob(function (b) { resolve(b) }, 'image/png')
    })
    if (!blob) return null

    const safe = String(name || 'receipt').replace(/[^a-z0-9-]/gi, '-')
    const path = 'receipts/' + Date.now() + '-' + safe + '.png'

    const { error } = await sb.storage.from('chat-attachments')
      .upload(path, blob, { contentType: 'image/png' })
    if (error) { console.warn('[receipt png] upload failed:', error.message); return null }

    return sb.storage.from('chat-attachments').getPublicUrl(path).data.publicUrl
  } catch (e) {
    console.warn('[receipt png] capture failed:', e.message)
    return null
  } finally {
    iframe.remove()
  }
}

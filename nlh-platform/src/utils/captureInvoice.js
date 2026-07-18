// Capture the rendered invoice sheet as a PNG and store it in the public
// chat-attachments bucket, so it can be sent as a WhatsApp image header and
// rendered inline in the platform's WhatsApp Inbox.
//
// We screenshot the live #inv-sheet element rather than re-rendering the
// invoice, so the image is pixel-identical to what is printed — one design,
// one source of truth.

import html2canvas from 'html2canvas'
import { sb } from '../supabase'

/**
 * @param {string} invoiceNo  used for the stored filename
 * @param {string} elementId  defaults to the invoice sheet
 * @returns {Promise<string|null>} public URL of the PNG, or null on failure
 */
export async function captureInvoicePng(invoiceNo, elementId) {
  const el = document.getElementById(elementId || 'inv-sheet')
  if (!el) return null

  try {
    const canvas = await html2canvas(el, {
      scale: 2,                 // crisp enough to read line items on a phone
      backgroundColor: '#ffffff',
      useCORS: true,            // logo / QR are same-origin, but be safe
      logging: false,
    })

    const blob = await new Promise(function (resolve) {
      canvas.toBlob(function (b) { resolve(b) }, 'image/png')
    })
    if (!blob) return null

    const safeNo = String(invoiceNo || 'invoice').replace(/[^a-z0-9-]/gi, '-')
    const path = `invoices/${Date.now()}-${safeNo}.png`

    const { error } = await sb.storage.from('chat-attachments')
      .upload(path, blob, { contentType: 'image/png' })
    if (error) { console.warn('[invoice png] upload failed:', error.message); return null }

    return sb.storage.from('chat-attachments').getPublicUrl(path).data.publicUrl
  } catch (e) {
    console.warn('[invoice png] capture failed:', e.message)
    return null
  }
}

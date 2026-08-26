import Razorpay from 'razorpay'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './_auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://frnnoxudtlvhyyoqdqzx.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZybm5veHVkdGx2aHl5b3FkcXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNTY2NDUsImV4cCI6MjA5MjkzMjY0NX0.1OuqWuV-X09wEzWMp9_zjNRbWNDcSvR4TgYmu0373zE'

// Previously this endpoint had NO auth check at all, and trusted whatever
// `amount` the client sent — an unauthenticated caller could create a
// Razorpay order for any orderId/amount pair. It's locked down now:
//   1. requireAuth — caller must have a valid session.
//   2. The order is fetched through an RLS-scoped client (the caller's own
//      JWT), so it 404s unless the caller is actually allowed to see that
//      order — same hierarchy rules as everywhere else in the app.
//   3. The amount is clamped to the order's real outstanding balance
//      (grand_total - amount_paid) computed server-side, never trusted
//      from the client, so nobody can request a token for less than what's
//      actually owed (or for an order that's already fully paid).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (await requireAuth(req, res)) return

  const { orderId, amount } = req.body   // amount in whole rupees — advisory only, see below
  if (!orderId) return res.status(400).json({ error: 'orderId required' })

  const callerToken = (req.headers['authorization'] || '').replace('Bearer ', '')
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${callerToken}` } },
  })

  const { data: order, error: orderErr } = await sb.from('orders')
    .select('id, grand_total, amount_paid, status')
    .eq('id', orderId)
    .maybeSingle()
  if (orderErr || !order) return res.status(404).json({ error: 'Order not found' })
  if (order.status === 'closed') return res.status(400).json({ error: 'Order is already fully paid' })

  const balance = Math.max(0, (order.grand_total || 0) - (order.amount_paid || 0))
  if (balance <= 0) return res.status(400).json({ error: 'Order has no outstanding balance' })

  // Allow paying less than the full balance (partial payment, same as the
  // manual "Record Pmt" flow) but never more than what's actually owed.
  const chargeAmount = Math.min(Math.max(1, Math.round(Number(amount) || balance)), balance)

  const keyId     = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) return res.status(500).json({ error: 'Razorpay not configured' })

  const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret })

  try {
    const rzpOrder = await rzp.orders.create({
      amount:   chargeAmount * 100,      // Razorpay uses paise
      currency: 'INR',
      receipt:  orderId,                 // your NLH order ID for reference
      notes:    { nlh_order_id: orderId },
    })
    return res.status(200).json({ success: true, rzpOrderId: rzpOrder.id, keyId, amount: chargeAmount })
  } catch (err) {
    console.error('Razorpay order create error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

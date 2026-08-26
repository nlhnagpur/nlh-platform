import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

// Use the service-role key here (bypasses RLS) — keep it server-only
const sb = createClient(
  process.env.SUPABASE_URL     || 'https://frnnoxudtlvhyyoqdqzx.supabase.co',
  process.env.SUPABASE_SERVICE_KEY                 // set this in Vercel env vars
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // 1. Verify Razorpay signature
  const webhookSecret   = process.env.RAZORPAY_WEBHOOK_SECRET
  const receivedSig     = req.headers['x-razorpay-signature']
  const body            = JSON.stringify(req.body)
  const expectedSig     = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex')

  if (receivedSig !== expectedSig) {
    console.error('Webhook signature mismatch')
    return res.status(400).json({ error: 'Invalid signature' })
  }

  const event = req.body
  if (event.event !== 'payment.captured') return res.status(200).end()  // ignore other events

  const payment    = event.payload.payment.entity
  const nlhOrderId = payment.notes?.nlh_order_id
  const amountPaid = Math.round(payment.amount / 100)   // convert paise → rupees

  if (!nlhOrderId) return res.status(200).end()

  // Idempotency: Razorpay retries undelivered webhooks, and this same
  // payment.id may already have been recorded — never double-count it.
  const { data: existing } = await sb.from('order_payments')
    .select('id').eq('reference', payment.id).eq('order_id', nlhOrderId).maybeSingle()
  if (existing) {
    console.log('Payment', payment.id, 'already recorded for order', nlhOrderId, '— skipping')
    return res.status(200).json({ received: true, duplicate: true })
  }

  // 2. Record the payment — never set orders.status/amount_paid directly
  // here. sync_order_payment_total() (trigger on order_payments) sums all
  // payments for the order and caps status at 'part_paid' unless the sum
  // actually covers grand_total, so a stray low-amount Razorpay payment
  // can't mark a large order 'closed' the way blindly trusting this single
  // payment's amount would.
  const { error } = await sb.from('order_payments').insert({
    order_id:  nlhOrderId,
    amount:    amountPaid,
    paid_on:   new Date().toISOString().slice(0, 10),
    mode:      'razorpay',
    reference: payment.id,
    note:      'Razorpay auto-capture (webhook)',
  })

  if (error) {
    console.error('Supabase insert error:', error)
    return res.status(500).json({ error: error.message })
  }

  console.log('Payment captured for order', nlhOrderId, '— ₹' + amountPaid)
  return res.status(200).json({ received: true })
}

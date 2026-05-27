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

  // 2. Update the NLH order
  const { error } = await sb.from('orders').update({
    status:               'closed',
    payment_mode:         'razorpay',
    payment_ref:          payment.id,            // rzp payment ID e.g. pay_xxxxx
    amount_paid:          amountPaid,
    payment_submitted_at: new Date().toISOString(),
    payment_verified_at:  new Date().toISOString(),
  }).eq('id', nlhOrderId)

  if (error) {
    console.error('Supabase update error:', error)
    return res.status(500).json({ error: error.message })
  }

  console.log('Payment captured for order', nlhOrderId, '— ₹' + amountPaid)
  return res.status(200).json({ received: true })
}

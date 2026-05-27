import Razorpay from 'razorpay'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { orderId, amount } = req.body   // amount in whole rupees
  if (!orderId || !amount) return res.status(400).json({ error: 'orderId and amount required' })

  const keyId     = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) return res.status(500).json({ error: 'Razorpay not configured' })

  const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret })

  try {
    const rzpOrder = await rzp.orders.create({
      amount:   amount * 100,      // Razorpay uses paise
      currency: 'INR',
      receipt:  orderId,           // your NLH order ID for reference
      notes:    { nlh_order_id: orderId },
    })
    return res.status(200).json({ success: true, rzpOrderId: rzpOrder.id, keyId })
  } catch (err) {
    console.error('Razorpay order create error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

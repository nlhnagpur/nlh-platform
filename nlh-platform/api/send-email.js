export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, toName, subject, htmlContent } = req.body;

  if (!to || !subject || !htmlContent) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, htmlContent' });
  }

  const key = process.env.BREVO_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Email service not configured' });
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': key,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'New Learning Horizons', email: 'admin@nlhnagpur.info' },
        to: [{ email: to, name: toName || to }],
        subject,
        htmlContent
      })
    });

    const data = await response.json();
    if (response.ok) {
      return res.status(200).json({ success: true, id: data.messageId });
    }
    console.error('Brevo error', response.status, JSON.stringify(data));
    return res.status(response.status).json({ success: false, error: data.message || 'Send failed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

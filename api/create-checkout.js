// ============================================
// api/create-ad-checkout.js
// Fonction Vercel Serverless — crée une session de paiement Stripe pour les pubs
// ============================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { priceId, adId, email, adType } = req.body;

    if (!priceId || !adId || !email) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('success_url', `${req.headers.origin}/annonceur.html?payment=success`);
    params.append('cancel_url', `${req.headers.origin}/annonceur.html?payment=cancelled`);
    params.append('customer_email', email);
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');
    params.append('metadata[ad_id]', adId);
    params.append('metadata[ad_type]', adType);
    params.append('subscription_data[metadata][ad_id]', adId);
    params.append('subscription_data[metadata][ad_type]', adType);

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    });

    const session = await stripeRes.json();

    if (session.error) {
      console.error('Erreur Stripe:', session.error);
      return res.status(400).json({ error: session.error.message });
    }

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Erreur serveur:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la création du paiement' });
  }
}

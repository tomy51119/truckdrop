// ============================================
// api/stripe-webhook.js
// Reçoit les événements Stripe et met à jour Supabase
// ============================================

export const config = {
  api: {
    bodyParser: false, // Important : Stripe a besoin du body brut pour vérifier la signature
  },
};

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const SUPABASE_URL = 'https://ooshjxostygdljkfhhwb.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers['stripe-signature'];

    // Vérification de la signature Stripe (sécurité anti-fraude)
    const event = await verifyStripeSignature(rawBody, signature, STRIPE_WEBHOOK_SECRET);

    if (!event) {
      return res.status(400).json({ error: 'Signature invalide' });
    }

    // ============================================
    // ÉVÉNEMENT : paiement de l'abonnement réussi
    // ============================================
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const truckId = session.metadata?.truck_id;
      const plan = session.metadata?.plan;
      const adId = session.metadata?.ad_id;

      // Cas 1 : paiement d'un abonnement food truck
      if (truckId && plan) {
        await updateTruckPlan(SUPABASE_URL, SUPABASE_SERVICE_KEY, truckId, plan, session.subscription, session.customer);
      }

      // Cas 2 : paiement d'une annonce publicitaire
      if (adId) {
        await updateAdStatus(SUPABASE_URL, SUPABASE_SERVICE_KEY, adId, 'active', session.subscription, session.customer);
      }
    }

    // ============================================
    // ÉVÉNEMENT : abonnement annulé ou impayé
    // ============================================
    if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
      const subscription = event.data.object;
      const truckId = subscription.metadata?.truck_id;
      const adId = subscription.metadata?.ad_id;

      if (truckId) {
        await updateTruckPlan(SUPABASE_URL, SUPABASE_SERVICE_KEY, truckId, 'gratuit', null, null);
      }

      if (adId) {
        await updateAdStatus(SUPABASE_URL, SUPABASE_SERVICE_KEY, adId, 'cancelled', null, null);
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Erreur webhook:', err);
    return res.status(500).json({ error: 'Erreur serveur webhook' });
  }
}

// ============================================
// Mise à jour du plan dans Supabase
// ============================================
async function updateTruckPlan(supabaseUrl, serviceKey, truckId, plan, subscriptionId, customerId) {
  const updateData = { plan };
  if (customerId) updateData.stripe_customer_id = customerId;

  await fetch(`${supabaseUrl}/rest/v1/food_trucks?id=eq.${truckId}`, {
    method: 'PATCH',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(updateData)
  });

  // Enregistrer l'abonnement dans la table subscriptions
  if (subscriptionId) {
    await fetch(`${supabaseUrl}/rest/v1/subscriptions`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        truck_id: truckId,
        plan: plan,
        stripe_subscription_id: subscriptionId,
        status: 'active'
      })
    });
  }
}

// ============================================
// Mise à jour du statut d'une annonce dans Supabase
// ============================================
async function updateAdStatus(supabaseUrl, serviceKey, adId, status, subscriptionId, customerId) {
  const updateData = { status, updated_at: new Date().toISOString() };
  if (subscriptionId) updateData.stripe_subscription_id = subscriptionId;
  if (customerId) updateData.stripe_customer_id = customerId;

  await fetch(`${supabaseUrl}/rest/v1/ads?id=eq.${adId}`, {
    method: 'PATCH',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(updateData)
  });
}

// ============================================
// Vérification signature Stripe (sans librairie externe)
// ============================================
async function verifyStripeSignature(payload, signatureHeader, secret) {
  if (!signatureHeader || !secret) return null;

  const parts = signatureHeader.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {});

  const timestamp = parts.t;
  const signature = parts.v1;

  const signedPayload = `${timestamp}.${payload.toString()}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (expectedSignature !== signature) {
    console.error('Signature mismatch');
    return null;
  }

  return JSON.parse(payload.toString());
}

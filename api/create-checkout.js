/* ============================================================
   /api/create-checkout
   POST { address, lat, lng, zone_code, council }
   Creates a Stripe Checkout session ($9.99 AUD) and stores a
   pending report row in Supabase before returning the URL.
   ============================================================ */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

/* Standalone Vercel Node.js functions do not auto-parse the request body.
   Read the stream and parse JSON manually. */
async function parseJsonBody(req) {
  // Some environments pre-populate req.body (e.g. local dev with body-parser)
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk.toString(); });
    req.on('end',  () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const body = await parseJsonBody(req);
  const { address, lat, lng, zone_code, council } = body;

  if (!address) {
    return res.status(400).json({ error: 'Address is required.' });
  }

  try {
    const BASE_URL = process.env.BASE_URL || 'https://whatcanibuild.vercel.app';

    /* ── Create Stripe Checkout session ── */
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'aud',
          product_data: {
            name:        'WhatCanIBuild Property Report',
            description: 'Development potential report for ' + address
          },
          unit_amount: 999   // $9.99 AUD in cents
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: BASE_URL + '/report.html?token={CHECKOUT_SESSION_ID}',
      cancel_url:  BASE_URL + '/?cancelled=true',
      metadata: {
        address:   String(address).substring(0, 499), // Stripe 500-char limit per value
        lat:       lat  != null ? String(lat)       : '',
        lng:       lng  != null ? String(lng)       : '',
        zone_code: zone_code  || '',
        council:   council    || 'brisbane'
      }
    });

    /* ── Store pending report in Supabase ── */
    // Non-fatal if this fails — the webhook will upsert on payment completion.
    const { error: dbError } = await getSupabase()
      .from('wcib_reports')
      .insert({
        stripe_session_id: session.id,
        address,
        lat:       lat       || null,
        lng:       lng       || null,
        zone_code: zone_code || null,
        council:   council   || 'brisbane',
        status:    'pending'
      });

    if (dbError) {
      console.error('[create-checkout] Supabase insert error:', dbError.message);
    }

    return res.json({ url: session.url });

  } catch (err) {
    console.error('[create-checkout] error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout. Please try again.' });
  }
};

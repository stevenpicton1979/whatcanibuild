/* ============================================================
   /api/webhook
   POST — Stripe webhook endpoint
   Handles checkout.session.completed:
     1. Verifies Stripe signature against raw body
     2. Calls ZoneIQ for full planning data
     3. Generates and stores report in Supabase
     4. Sends confirmation email via Resend

   IMPORTANT: This handler reads the raw HTTP stream directly.
   Standalone Vercel Node.js functions do not pre-parse the body,
   so we can safely read from req before any parsing occurs.
   This is required for Stripe webhook signature verification —
   constructEvent() needs the exact raw bytes, not re-serialised JSON.
   ============================================================ */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data',  chunk => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    req.on('end',   () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });

  /* ── Verify Stripe signature ── */
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    console.error('[webhook] Failed to read body:', err.message);
    return res.status(400).json({ error: 'Failed to read request body' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message);
    return res.status(400).send('Webhook Error: ' + err.message);
  }

  /* ── Only process completed checkouts ── */
  if (event.type !== 'checkout.session.completed') {
    return res.json({ received: true, ignored: true });
  }

  const session       = event.data.object;
  const sessionId     = session.id;
  const customerEmail = session.customer_details?.email;
  const meta          = session.metadata || {};
  const { address, lat, lng, zone_code, council } = meta;

  console.log('[webhook] Processing session:', sessionId, 'for:', address);

  const db = getSupabase();

  try {
    /* ── Fetch full data from ZoneIQ ── */
    const zoneRes = await fetch(
      'https://zoneiq.com.au/api/lookup?' + new URLSearchParams({ address }),
      { headers: { 'User-Agent': 'WhatCanIBuild/1.0' } }
    );

    if (!zoneRes.ok) throw new Error('ZoneIQ returned ' + zoneRes.status);

    const zoneData = await zoneRes.json();
    const report   = generateReport(zoneData, address);

    /* ── Update Supabase record ── */
    const { error: updateErr } = await db
      .from('wcib_reports')
      .update({
        report_data:    report,
        status:         'paid',
        customer_email: customerEmail || null
      })
      .eq('stripe_session_id', sessionId);

    if (updateErr) throw new Error('Supabase update failed: ' + updateErr.message);

    /* ── Send confirmation email via Resend ── */
    if (customerEmail) {
      try {
        const resend  = new Resend(process.env.RESEND_API_KEY);
        const baseUrl = process.env.BASE_URL || 'https://whatcanibuild.com.au';

        await resend.emails.send({
          from:    'WhatCanIBuild <hello@clearoffer.com.au>',
          to:      customerEmail,
          subject: 'Your WhatCanIBuild Report is ready',
          html:    buildEmailHtml(report, sessionId, baseUrl)
        });

        console.log('[webhook] Email sent to:', customerEmail);
      } catch (emailErr) {
        // Non-fatal — report is still accessible via the token
        console.error('[webhook] Email send failed:', emailErr.message);
      }
    }

    console.log('[webhook] Done:', sessionId);
    return res.json({ received: true });

  } catch (err) {
    console.error('[webhook] Processing error:', err.message);

    // Mark as failed so the report page can surface a helpful message
    try {
      await db
        .from('wcib_reports')
        .update({ status: 'failed' })
        .eq('stripe_session_id', sessionId);
    } catch (e) {
      console.error('[webhook] Failed to set status=failed:', e.message);
    }

    // Return 200 to prevent Stripe from retrying (error is not transient)
    return res.json({ received: true, error: err.message });
  }
};

/* ============================================================
   REPORT GENERATION
   ============================================================ */

function generateReport(zoneiqData, fallbackAddress) {
  const rules    = zoneiqData.rules    || {};
  const overlays = zoneiqData.overlays || {};
  const zone     = zoneiqData.zone     || {};
  const address  = zoneiqData.query?.address_resolved || fallbackAddress;

  return {
    address,
    zone_name:    zone.name    || 'Unknown Zone',
    zone_code:    zone.code    || 'UNK',
    council:      zone.council || 'brisbane',
    generated_at: new Date().toISOString(),

    questions: [
      {
        id:           'granny_flat',
        question:     'Can I build a granny flat / secondary dwelling?',
        answer:       rules.secondary_dwelling_permitted || 'unknown',
        plain_english: plainEnglish('secondary_dwelling', rules.secondary_dwelling_permitted),
        html_safe:    true,
        icon:         '🏠'
      },
      {
        id:           'subdivision',
        question:     'Can I subdivide my block?',
        answer:       rules.subdivision_min_lot_size_m2 ? 'possible' : 'unlikely',
        plain_english: rules.subdivision_min_lot_size_m2
          ? 'Subdivision may be possible. Minimum lot size is ' + rules.subdivision_min_lot_size_m2 + 'm² — so your block needs to be at least ' + (rules.subdivision_min_lot_size_m2 * 2) + 'm² to create two lots. A town planner or surveyor can advise on feasibility (typically $500–1,500 for initial advice). <a href="https://www.brisbane.qld.gov.au/planning-and-building/development-applications/subdividing-land" target="_blank" rel="noopener">BCC subdivision guide →</a>'
          : 'Subdivision is unlikely in this zone. If your block is unusually large, confirm with Brisbane City Council.',
        html_safe: true,
        icon: '🏗️'
      },
      {
        id:           'airbnb',
        question:     'Can I do Airbnb / short-term accommodation?',
        answer:       rules.short_term_accom_permitted || 'unknown',
        plain_english: plainEnglish('airbnb', rules.short_term_accom_permitted),
        icon:         '🏡'
      },
      {
        id:           'home_business',
        question:     'Can I run a business from home?',
        answer:       rules.home_business_permitted || 'unknown',
        plain_english: plainEnglish('home_business', rules.home_business_permitted),
        icon:         '💼'
      },
      {
        id:       'height',
        question: 'How tall can I build?',
        answer:   'info',
        plain_english: rules.max_height_m
          ? 'Maximum height is ' + rules.max_height_m + 'm' +
            (rules.max_storeys ? ' (' + rules.max_storeys + ' storeys).' : '.')
          : 'Height limit not set at the zone level for this property — it may be controlled by the Building Height Overlay. Check <a href="https://www.brisbane.qld.gov.au/planning-and-building/planning-guidelines-and-tools/brisbane-city-plan-2014" target="_blank" rel="noopener">Brisbane City Plan 2014 →</a> or contact council.',
        icon: '📏'
      },
      {
        id:       'site_coverage',
        question: 'How much of my block can I build on?',
        answer:   'info',
        plain_english: rules.max_site_coverage_pct
          ? 'You can build on up to ' + rules.max_site_coverage_pct + '% of your lot.' +
            (rules.min_permeability_pct ? ' At least ' + rules.min_permeability_pct + '% must remain unpaved.' : '')
          : 'Site coverage limits are not set at the zone level — check with Brisbane City Council or refer to the specific overlay code for your address.',
        icon: '📐'
      },
      {
        id:       'setbacks',
        question: 'How close to the boundary can I build?',
        answer:   'info',
        plain_english: rules.setbacks
          ? 'Front: ' + (rules.setbacks.front_m ?? '?') + 'm from street. ' +
            'Side: '  + (rules.setbacks.side_m  ?? '?') + 'm. ' +
            'Rear: '  + (rules.setbacks.rear_m  ?? '?') + 'm.'
          : 'Setback requirements vary by lot size and zone. Refer to <a href="https://www.brisbane.qld.gov.au/planning-and-building/planning-guidelines-and-tools/brisbane-city-plan-2014" target="_blank" rel="noopener">Brisbane City Plan 2014 Table 6.1 →</a> or contact a town planner.',
        icon: '📍'
      },
      {
        id:       'flood',
        question: 'Is there a flood overlay on my property?',
        answer:   overlays.flood?.has_flood_overlay ? 'yes' : 'no',
        plain_english: overlays.flood?.has_flood_overlay
          ? 'Flood overlay applies' +
            (overlays.flood.risk_level ? ' (' + overlays.flood.risk_level + ' risk)' : '') +
            '. This affects what can be built and sets minimum floor heights. Get the full flood report from <a href="https://floodwise.brisbane.qld.gov.au/" target="_blank" rel="noopener">Brisbane FloodWise portal →</a> before making any development or purchase decisions.'
          : 'No flood overlay identified for this property based on Brisbane City Plan 2014 data.',
        html_safe: true,
        icon: '🌊'
      },
      {
        id:       'character',
        question: 'Is my property in a character/heritage street?',
        answer:   overlays.character?.has_character_overlay ? 'yes' : 'no',
        plain_english: overlays.character?.has_character_overlay
          ? 'Character overlay applies. Demolition of pre-1947 dwellings requires additional assessment and is often refused. Any additions must respect the existing streetscape character. <a href="https://www.brisbane.qld.gov.au/planning-and-building/planning-guidelines-and-tools/brisbane-city-plan-2014/overlays/character-residential-overlay" target="_blank" rel="noopener">Character overlay rules →</a>'
          : 'No character overlay identified. Standard zone rules apply.',
        html_safe: true,
        icon: '🏛️'
      },
      {
        id:       'schools',
        question: 'Which schools is this property zoned for?',
        answer:   'info',
        plain_english: overlays.schools?.length > 0
          ? overlays.schools.map(s => s.school_name + ' (' + s.school_type + ')').join(', ')
          : 'School catchment data not available for this address. Check the Queensland Government school catchment finder.',
        icon: '🏫'
      }
    ],

    key_rules:  zoneiqData.key_rules || [],
    source:     'Brisbane City Plan 2014',
    disclaimer: 'This report provides indicative planning information only. Rules may be affected by neighbourhood plans, recent amendments, or site-specific overlays not reflected here. Always verify with your relevant council (Brisbane City Council, Gold Coast City Council, or Moreton Bay Regional Council) before making development decisions.'
  };
}

function plainEnglish(type, value, rules) {
  const map = {
    secondary_dwelling: {
      yes:             'Yes — you can build a secondary dwelling without a permit, subject to size limits (typically max 80m²) and setback requirements. No DA required for compliant builds.',
      permit_required: 'A permit is required. In most residential zones this is a code-assessable development application — a town planner can prepare one for around $1,500–3,000. <a href="https://www.brisbane.qld.gov.au/planning-and-building/development-applications" target="_blank" rel="noopener">Brisbane City Council DA portal →</a>',
      no:              'Secondary dwellings are not permitted in this zone. If you believe this is incorrect, verify with Brisbane City Council.'
    },
    airbnb: {
      yes:             'Short-term accommodation (Airbnb, Stayz etc.) is a permitted use in this zone — no development approval needed. Keep records in case of neighbour disputes.',
      permit_required: 'A development permit is required. Short-term accommodation in residential zones is assessed against the Short-term Accommodation code in City Plan 2014. Consider consulting a town planner before listing.',
      no:              'Short-term accommodation is not permitted as of right in this zone. Operating without approval risks council enforcement action.'
    },
    home_business: {
      yes:             'Yes — home-based businesses are permitted. Restrictions apply: no more than 2 non-resident employees, no external signage, and no impact on neighbourhood character.',
      permit_required: 'A permit may be required depending on the nature and scale of the business. Low-impact home offices are generally exempt — check the Home Based Business code in City Plan 2014.',
      no:              'Home-based businesses are not permitted in this zone as of right. Contact Brisbane City Council to discuss your specific situation.'
    }
  };

  const result = map[type]?.[value];
  if (result) return result;
  if (!value || value === 'unknown') {
    return 'Data not available for this zone. Contact Brisbane City Council for confirmation.';
  }
  return value;
}

/* ============================================================
   EMAIL TEMPLATE
   ============================================================ */

function buildEmailHtml(report, sessionId, baseUrl) {
  const reportUrl    = baseUrl + '/report.html?token=' + sessionId;
  const previewItems = report.questions.slice(0, 3);

  const rows = previewItems.map(q => {
    const emoji = q.answer === 'yes'             ? '✅'
                : q.answer === 'permit_required'  ? '⚠️'
                : q.answer === 'no'              ? '❌'
                : 'ℹ️';
    return (
      '<tr>' +
        '<td style="padding:12px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#1e293b;">' +
          q.icon + ' <strong>' + escHtml(q.question) + '</strong><br>' +
          '<span style="color:#475569;">' + emoji + ' ' + escHtml(q.plain_english) + '</span>' +
        '</td>' +
      '</tr>'
    );
  }).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:0;">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px;">

    <p style="font-size:18px;font-weight:800;color:#f59e0b;margin:0 0 32px;">WhatCanIBuild</p>

    <h1 style="font-size:22px;font-weight:800;color:#0f172a;margin:0 0 6px;">
      Your property report is ready
    </h1>
    <p style="color:#64748b;font-size:15px;margin:0 0 24px;">${escHtml(report.address)}</p>

    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:24px;">
      <div style="margin-bottom:14px;">
        <span style="background:#f59e0b;color:#1a1a1a;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;">
          ${escHtml(report.zone_name)} (${escHtml(report.zone_code)})
        </span>
      </div>
      <p style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin:0 0 10px;">
        Preview — 3 of 10 questions
      </p>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
    </div>

    <a href="${reportUrl}"
       style="display:block;background:#f59e0b;color:#1a1a1a;text-decoration:none;text-align:center;
              padding:16px 24px;border-radius:8px;font-weight:700;font-size:16px;margin-bottom:20px;">
      View Full Report →
    </a>

    <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin-bottom:24px;">
      This report will be available at the link above for 90 days.
    </p>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px;">

    <p style="color:#94a3b8;font-size:11px;line-height:1.6;">${escHtml(report.disclaimer)}</p>

  </div>
</body>
</html>`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

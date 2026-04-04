/* ============================================================
   /api/get-report
   GET ?token=STRIPE_SESSION_ID
   Returns { status, address, report, created_at }
   status: 'pending' | 'paid' | 'failed'
   report is only populated when status === 'paid'
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.query.token || '').trim();

  if (token.length < 10) {
    return res.status(400).json({ error: 'A valid report token is required.' });
  }

  try {
    const { data, error } = await getSupabase()
      .from('wcib_reports')
      .select('stripe_session_id, address, status, report_data, created_at, expires_at')
      .eq('stripe_session_id', token)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This report has expired (90-day limit).' });
    }

    return res.json({
      status:     data.status,
      address:    data.address,
      report:     data.status === 'paid' ? data.report_data : null,
      created_at: data.created_at
    });

  } catch (err) {
    console.error('[get-report] error:', err.message);
    return res.status(500).json({ error: 'Failed to retrieve report. Please try again.' });
  }
};

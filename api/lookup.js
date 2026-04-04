/* ============================================================
   /api/lookup
   GET ?address=...
   1. Geocodes address via Nominatim
   2. Fetches zone + rules from ZoneIQ
   3. Returns preview data (zone, granny flat teaser)
   ============================================================ */

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const address = (req.query.address || '').trim();

  if (address.length < 5) {
    return res.status(400).json({ valid: false, error: 'Please enter a valid address.' });
  }

  try {
    /* ── Step 1: Geocode via Nominatim ── */
    const searchQuery = /Brisbane|Gold Coast|Moreton Bay|QLD/i.test(address)
      ? address
      : address + ', QLD Australia';

    const nominatimUrl = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      q:            searchQuery,
      format:       'json',
      limit:        1,
      countrycodes: 'au'
    });

    const geoRes = await fetch(nominatimUrl, {
      headers: {
        'User-Agent':      'WhatCanIBuild/1.0 (whatcanibuild.com.au)',
        'Accept-Language': 'en'
      }
    });

    if (!geoRes.ok) throw new Error('Nominatim returned ' + geoRes.status);

    const geoData = await geoRes.json();
    if (!geoData || geoData.length === 0) {
      return res.json({ valid: false, error: 'Address not found. Please try a more specific address.' });
    }

    const geo = geoData[0];
    const lat = parseFloat(geo.lat);
    const lng = parseFloat(geo.lon);
    const resolvedAddress = geo.display_name;

    /* ── Step 2: ZoneIQ lookup ── */
    const zoneiqUrl = 'https://www.zoneiq.com.au/api/lookup?' + new URLSearchParams({
      address
    });

    const zoneRes = await fetch(zoneiqUrl, {
      headers: { 'User-Agent': 'WhatCanIBuild/1.0' }
    });

    if (!zoneRes.ok) throw new Error('ZoneIQ returned ' + zoneRes.status);

    const zoneData = await zoneRes.json();

    if (!zoneData || !zoneData.success) {
      const errCode = zoneData?.error;
      if (errCode === 'OUTSIDE_COVERAGE') {
        return res.json({ valid: false, error: 'Address is outside our coverage area. We currently cover Brisbane, Gold Coast and Moreton Bay.' });
      }
      if (errCode === 'ZONE_NOT_SEEDED') {
        return res.json({ valid: false, error: 'Planning data not yet available for this address. We\'re working on expanding our coverage.' });
      }
      return res.json({ valid: false, error: 'Address not found in coverage area. We currently cover Brisbane, Gold Coast and Moreton Bay.' });
    }

    /* ── Step 3: Build preview response ── */
    const grannyStatus = zoneData.rules?.secondary_dwelling_permitted || 'unknown';

    const grannyLabels = {
      yes:             'Granny flat permitted',
      permit_required: 'Granny flat requires a permit',
      no:              'Granny flat not permitted in this zone',
      unknown:         'Granny flat status unclear — check with council'
    };

    return res.json({
      address:   resolvedAddress,
      lat,
      lng,
      zone_name: zoneData.zone.name  || 'Unknown Zone',
      zone_code: zoneData.zone.code  || 'UNK',
      council:   zoneData.zone.council || 'brisbane',
      teaser: {
        granny_flat:       grannyStatus,
        granny_flat_label: grannyLabels[grannyStatus] || grannyLabels.unknown
      },
      valid: true
    });

  } catch (err) {
    console.error('[lookup] error:', err.message);
    return res.status(500).json({ valid: false, error: 'Lookup failed. Please try again.' });
  }
};

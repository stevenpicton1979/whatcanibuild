/* ============================================================
   WhatCanIBuild — Frontend App
   Handles both index.html (search + preview) and
   report.html (poll + render report).
   ============================================================ */

const PAGE        = document.body.classList.contains('report-page') ? 'report' : 'index';
let _pollInterval = null;
let _pollCount    = 0;
const MAX_POLLS   = 40;

if (PAGE === 'index') {
  initIndexPage();
} else {
  initReportPage();
}

/* ============================================================
   INDEX PAGE
   ============================================================ */

function initIndexPage() {
  const input       = document.getElementById('address-input');
  const searchBtn   = document.getElementById('search-btn');
  const dropdown    = document.getElementById('autocomplete-dropdown');
  const statusEl    = document.getElementById('search-status');
  const previewCard = document.getElementById('preview-card');
  const checkoutBtn = document.getElementById('checkout-btn');

  let debounceTimer  = null;
  let previewData    = null;  // holds last successful lookup result
  let activeIndex    = -1;

  // If user came back after cancelling payment, surface a message
  if (new URLSearchParams(window.location.search).get('cancelled') === 'true') {
    showStatus('Payment cancelled — enter your address to try again.', 'error');
    window.history.replaceState({}, '', '/');
  }

  /* ── Autocomplete ── */
  input.addEventListener('input', () => {
    const val = input.value.trim();
    clearTimeout(debounceTimer);
    if (val.length < 4) { hideDropdown(); return; }
    debounceTimer = setTimeout(() => fetchSuggestions(val), 500);
  });

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      highlightItem(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, -1);
      highlightItem(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && items[activeIndex]) {
        items[activeIndex].click();
      } else {
        runLookup(input.value.trim());
      }
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  });

  function highlightItem(items) {
    items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
  }

  /* ── Button clicks ── */
  searchBtn.addEventListener('click', () => runLookup(input.value.trim()));
  checkoutBtn.addEventListener('click', handleCheckout);

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) hideDropdown();
  });

  /* ── Nominatim autocomplete suggestions ── */
  async function fetchSuggestions(query) {
    try {
      const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
        q: query + ', QLD Australia',
        format: 'json',
        limit: 5,
        countrycodes: 'au',
        addressdetails: 0
      });
      const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      renderDropdown(data);
    } catch {
      hideDropdown();
    }
  }

  function renderDropdown(results) {
    if (!results || results.length === 0) { hideDropdown(); return; }
    activeIndex = -1;
    dropdown.innerHTML = '';
    results.forEach(r => {
      const item = document.createElement('div');
      item.className   = 'autocomplete-item';
      item.textContent = r.display_name;
      item.setAttribute('role', 'option');
      item.addEventListener('click', () => {
        input.value = r.display_name;
        hideDropdown();
        runLookup(r.display_name);
      });
      dropdown.appendChild(item);
    });
    dropdown.classList.remove('hidden');
  }

  function hideDropdown() {
    dropdown.classList.add('hidden');
    activeIndex = -1;
  }

  /* ── Address lookup ── */
  async function runLookup(address) {
    if (!address) return;
    hideDropdown();
    hidePreview();
    showStatus('Looking up address…', 'loading');
    setSearchBusy(true);

    try {
      const res  = await fetch('/api/lookup?address=' + encodeURIComponent(address));
      const data = await res.json();

      if (!data.valid) {
        showStatus(data.error || 'Address lookup failed. Please try again.', 'error');
        return;
      }

      clearStatus();
      previewData = data;
      renderPreview(data);

    } catch {
      showStatus('Connection error. Please check your internet and try again.', 'error');
    } finally {
      setSearchBusy(false);
    }
  }

  /* ── Preview card ── */
  function renderPreview(data) {
    document.getElementById('preview-address').textContent = data.address;
    document.getElementById('preview-zone').textContent =
      'Zone: ' + data.zone_name + ' (' + data.zone_code + ')';

    const granny    = data.teaser.granny_flat;
    const label     = data.teaser.granny_flat_label;
    const teaserEl  = document.getElementById('teaser-granny');
    teaserEl.textContent = statusEmoji(granny) + ' ' + label;
    teaserEl.className   = 'teaser-value ' + teaserClass(granny);

    previewCard.classList.remove('hidden');
    previewCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hidePreview() {
    previewCard.classList.add('hidden');
    previewData = null;
  }

  /* ── Checkout ── */
  async function handleCheckout() {
    if (!previewData) return;
    checkoutBtn.disabled = true;
    checkoutBtn.textContent = 'Redirecting to payment…';

    try {
      const res  = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address:   previewData.address,
          lat:       previewData.lat,
          lng:       previewData.lng,
          zone_code: previewData.zone_code,
          council:   previewData.council
        })
      });
      const data = await res.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'No checkout URL returned');
      }
    } catch (err) {
      showStatus('Payment setup failed. Please try again.', 'error');
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = 'Unlock full report — 10 questions answered → $19.99';
    }
  }

  /* ── Helpers ── */
  function setSearchBusy(busy) {
    searchBtn.disabled     = busy;
    searchBtn.textContent  = busy ? 'Looking up…' : 'Get My Report — $19.99';
  }

  function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className   = 'search-status ' + type;
    statusEl.classList.remove('hidden');
  }

  function clearStatus() {
    statusEl.classList.add('hidden');
  }
}

/* ============================================================
   REPORT PAGE
   ============================================================ */

function initReportPage() {
  const token = new URLSearchParams(window.location.search).get('token');
  if (!token) {
    showReportError('No report token found. Please complete your payment first.');
    return;
  }
  pollForReport(token);
}

// (_pollInterval, _pollCount, MAX_POLLS declared at top of file)

async function pollForReport(token) {
  _pollCount++;

  if (_pollCount > MAX_POLLS) {
    clearInterval(_pollInterval);
    showReportError(
      'Report generation is taking longer than expected. ' +
      'Please email hello@clearoffer.com.au with your payment confirmation.'
    );
    return;
  }

  try {
    const res = await fetch('/api/get-report?token=' + encodeURIComponent(token));

    if (res.status === 404) {
      clearInterval(_pollInterval);
      showReportError('Report not found. Please check your link or contact support.');
      return;
    }

    if (res.status === 410) {
      clearInterval(_pollInterval);
      showReportError('This report has expired (90-day limit).');
      return;
    }

    const data = await res.json();

    if (data.status === 'paid' && data.report) {
      clearInterval(_pollInterval);
      renderReport(data.report);
    } else if (data.status === 'failed') {
      clearInterval(_pollInterval);
      showReportError(
        'Report generation failed. Please contact hello@clearoffer.com.au for a refund.'
      );
    } else if (!_pollInterval) {
      // Still pending — start polling
      _pollInterval = setInterval(() => pollForReport(token), 3000);
    }
  } catch {
    // Network error — keep polling if not already
    if (!_pollInterval) {
      _pollInterval = setInterval(() => pollForReport(token), 3000);
    }
  }
}

function renderReport(report) {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('report-content').classList.remove('hidden');

  // Header
  document.getElementById('report-address').textContent = report.address;
  document.getElementById('report-zone').textContent =
    report.zone_name + ' (' + report.zone_code + ')';
  document.getElementById('report-council').textContent =
    report.council
      ? report.council.charAt(0).toUpperCase() + report.council.slice(1) + ' City Council'
      : '';
  document.getElementById('report-date').textContent =
    'Generated ' + new Date(report.generated_at).toLocaleDateString('en-AU', {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

  // Questions
  const grid = document.getElementById('questions-grid');
  grid.innerHTML = '';
  (report.questions || []).forEach(q => {
    const status = questionStatus(q.id, q.answer);
    const card   = document.createElement('div');
    card.className = 'question-card';
    card.innerHTML =
      '<div class="qcard-header">' +
        '<span class="qcard-icon">' + q.icon + '</span>' +
        '<span class="qcard-question">' + esc(q.question) + '</span>' +
      '</div>' +
      '<div class="qcard-status ' + status.cls + '">' + status.emoji + ' ' + esc(status.label) + '</div>' +
      '<div class="qcard-body">' + (q.html_safe ? q.plain_english : esc(q.plain_english)) + '</div>';
    grid.appendChild(card);
  });

  // Key rules
  if (report.key_rules && report.key_rules.length > 0) {
    const sec  = document.getElementById('key-rules-section');
    const list = document.getElementById('key-rules-list');
    sec.classList.remove('hidden');
    list.innerHTML = report.key_rules
      .map(r => '<li>' + esc(r) + '</li>')
      .join('');
  }

  // Footer
  document.getElementById('report-source').textContent = 'Source: ' + report.source;
  document.getElementById('report-disclaimer').textContent = report.disclaimer;
}

/* ── Status mapping for report cards ── */
function questionStatus(id, answer) {
  if (answer === 'info')  return { cls: 'status-info',  emoji: 'ℹ️',  label: 'Info' };
  if (answer === 'yes') {
    if (id === 'flood')     return { cls: 'status-amber', emoji: '⚠️',  label: 'Overlay present' };
    if (id === 'character') return { cls: 'status-info',  emoji: 'ℹ️',  label: 'Overlay present' };
    return                         { cls: 'status-green', emoji: '✅',  label: 'Permitted' };
  }
  if (answer === 'permit_required') return { cls: 'status-amber', emoji: '⚠️', label: 'Permit required' };
  if (answer === 'possible')        return { cls: 'status-amber', emoji: '⚠️', label: 'Possible' };
  if (answer === 'no') {
    if (id === 'flood' || id === 'character')
      return { cls: 'status-green', emoji: '✅', label: 'No overlay' };
    return { cls: 'status-red', emoji: '❌', label: 'Not permitted' };
  }
  if (answer === 'unlikely') return { cls: 'status-red',  emoji: '❌',  label: 'Unlikely' };
  return { cls: 'status-info', emoji: 'ℹ️', label: answer || 'See details' };
}

function showReportError(msg) {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('error-state').classList.remove('hidden');
  document.getElementById('error-message').textContent = msg;
}

/* ── Shared helpers ── */
function statusEmoji(s) {
  return s === 'yes' ? '✅' : s === 'permit_required' ? '⚠️' : s === 'no' ? '❌' : 'ℹ️';
}

function teaserClass(s) {
  return s === 'yes' ? 'tv-green' : s === 'permit_required' ? 'tv-amber' : s === 'no' ? 'tv-red' : 'tv-info';
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

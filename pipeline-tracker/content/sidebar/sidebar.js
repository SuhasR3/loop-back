/**
 * Sidebar v2 — Updated for dual-dimension state model.
 *
 * Deals now have:
 *   direction: "you_owe" | "they_owe"  (who owes the next reply)
 *   timing:    "active" | "scheduled" | "stale"  (is it on schedule)
 *   terminal:  null | "dead" | "won"
 *
 * Filters let you slice by either dimension independently.
 */

let allDeals = [];
let currentFilter = 'all';

async function refreshSidebar() {
  const container = document.getElementById('pt-deals');
  if (container) container.innerHTML = '<div class="pt-loading">Loading deals...</div>';

  try {
    const response = await window.loopBackChrome.sendMessage({ type: 'get_deals' });
    if (response === undefined) {
      window.loopBackChrome?.showReloadHint();
      if (container) {
        container.innerHTML =
          '<div class="pt-empty"><div class="pt-empty-text">Could not reach the extension. Refresh this Gmail tab (\u2318R).</div></div>';
      }
      return;
    }

    if (response.error && container) {
      container.innerHTML = `<div class="pt-empty"><div class="pt-empty-text">${escapeHtml(response.error)}</div></div>`;
      return;
    }

    allDeals = response.deals || [];
    const counts = response.counts || {};

    renderBadges(counts);
    renderFilters();
    renderDealCards(allDeals, currentFilter);

    const timeline = document.getElementById('pt-timeline');
    if (timeline) timeline.style.display = 'none';

    await updateScanStatusBar();
  } catch (err) {
    if (String(err?.message || '').includes('Extension context invalidated')) {
      window.loopBackChrome?.showReloadHint();
      return;
    }
    console.error('[LoopBack Sidebar] Error refreshing:', err);
  }
}

async function updateScanStatusBar() {
  const statusEl = document.querySelector('.pt-scan-status');
  if (!statusEl) return;

  const data = await window.loopBackChrome.storageLocalGet(['scan_status', 'scan_error', 'last_scan_timestamp']);
  const status = data.scan_status || 'idle';

  if (status === 'error' && data.scan_error) {
    statusEl.textContent = `\u26A0 ${data.scan_error}`;
    statusEl.style.color = 'var(--pt-red)';
  } else if (status === 'scanning') {
    statusEl.textContent = '\u27F3 Scanning\u2026';
    statusEl.style.color = 'var(--pt-blue)';
  } else {
    const lastScan = data.last_scan_timestamp
      ? new Date(data.last_scan_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'never';
    statusEl.textContent = `Last scan: ${lastScan}`;
    statusEl.style.color = '';
  }
}

// ── Badge row: show Direction and Timing as separate groups ────────

function renderBadges(counts) {
  const el = document.getElementById('pt-badges');
  if (!el) return;

  el.innerHTML = `
    <div class="pt-badge-group">
      <div class="pt-badge-group-label">Direction</div>
      <div class="pt-badge-group-row">
        <div class="pt-badge pt-badge--you-owe" data-filter="you_owe">
          <span class="pt-badge-count">${counts.you_owe || 0}</span>
          <span class="pt-badge-label">You Owe</span>
        </div>
        <div class="pt-badge pt-badge--they-owe" data-filter="they_owe">
          <span class="pt-badge-count">${counts.they_owe || 0}</span>
          <span class="pt-badge-label">They Owe</span>
        </div>
      </div>
    </div>
    <div class="pt-badge-group">
      <div class="pt-badge-group-label">Timing</div>
      <div class="pt-badge-group-row">
        <div class="pt-badge pt-badge--active" data-filter="active">
          <span class="pt-badge-count">${counts.active || 0}</span>
          <span class="pt-badge-label">Active</span>
        </div>
        <div class="pt-badge pt-badge--scheduled" data-filter="scheduled">
          <span class="pt-badge-count">${counts.scheduled || 0}</span>
          <span class="pt-badge-label">Sched</span>
        </div>
        <div class="pt-badge pt-badge--stale" data-filter="stale">
          <span class="pt-badge-count">${counts.stale || 0}</span>
          <span class="pt-badge-label">Stale</span>
        </div>
      </div>
    </div>
  `;

  el.querySelectorAll('.pt-badge').forEach((badge) => {
    badge.addEventListener('click', () => setFilter(badge.dataset.filter));
  });

  const outEl = document.getElementById('pt-outgoing-dues');
  const inEl = document.getElementById('pt-incoming-dues');
  if (outEl) outEl.textContent = formatCurrency(counts.outgoing_dues_total || 0);
  if (inEl) inEl.textContent = formatCurrency(counts.incoming_dues_total || 0);
}

// ── Filter pills ───────────────────────────────────────────────────

function renderFilters() {
  const el = document.getElementById('pt-filters');
  if (!el) return;

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'you_owe', label: 'You Owe' },
    { key: 'they_owe', label: 'They Owe' },
    { key: 'active', label: 'Active' },
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'stale', label: 'Stale' },
  ];

  el.innerHTML = filters
    .map(
      (f) =>
        `<button class="pt-pill${f.key === currentFilter ? ' pt-pill--active' : ''}" data-filter="${f.key}">${f.label}</button>`
    )
    .join('');

  el.querySelectorAll('.pt-pill').forEach((pill) => {
    pill.addEventListener('click', () => setFilter(pill.dataset.filter));
  });
}

// ── Deal cards ─────────────────────────────────────────────────────

function matchesFilter(deal, filter) {
  if (filter === 'all') {
    // Exclude terminal states from "All"
    return !deal.terminal;
  }
  // Direction filters
  if (filter === 'you_owe' || filter === 'they_owe') {
    return deal.direction === filter && !deal.terminal;
  }
  // Timing filters
  if (filter === 'active' || filter === 'scheduled' || filter === 'stale') {
    return deal.timing === filter && !deal.terminal;
  }
  return false;
}

function renderDealCards(deals, filter = 'all') {
  const el = document.getElementById('pt-deals');
  const timeline = document.getElementById('pt-timeline');
  if (!el) return;

  if (timeline) timeline.style.display = 'none';
  el.style.display = 'flex';

  const filtered = deals.filter((d) => matchesFilter(d, filter));

  if (filtered.length === 0) {
    el.innerHTML = `
      <div class="pt-empty">
        <div class="pt-empty-icon">\uD83D\uDCED</div>
        <div class="pt-empty-text">No deals in this category</div>
      </div>`;
    return;
  }

  el.innerHTML = filtered.map((deal) => renderDealCard(deal)).join('');

  el.querySelectorAll('.pt-deal-card').forEach((card) => {
    card.addEventListener('click', () => renderTimeline(card.dataset.dealId));
  });
}

function renderDealCard(deal) {
  const staleColor = getStalenessColor(deal.staleness_days);
  const staleText = formatStaleness(deal.staleness_days);

  // Two-pill approach: one for direction, one for timing
  const directionPill = deal.direction
    ? `<span class="pt-state-pill pt-state-pill--${deal.direction}">${getDirectionLabel(deal.direction)}</span>`
    : '';
  const timingPill = deal.timing
    ? `<span class="pt-state-pill pt-state-pill--${deal.timing}">${getTimingLabel(deal.timing)}</span>`
    : '';
  const urgentBadge = deal.urgent
    ? `<span class="pt-urgent-badge">URGENT</span>`
    : '';

  return `
    <div class="pt-deal-card ${deal.urgent ? 'pt-deal-card--urgent' : ''}" data-deal-id="${deal.id}">
      <div class="pt-deal-card-top">
        <span class="pt-deal-company">${escapeHtml(deal.company || deal.subject)}</span>
        <span class="pt-deal-value">${deal.deal_value ? formatCurrency(deal.deal_value) : ''}</span>
      </div>
      <div class="pt-deal-contact">${escapeHtml(deal.contact_name || '')}${deal.contact_name && deal.last_action_summary ? ' \u2014 ' : ''}${escapeHtml(deal.last_action_summary || '')}</div>
      <div class="pt-deal-bottom">
        ${directionPill}${timingPill}${urgentBadge}
        <span class="pt-staleness pt-staleness--${staleColor}">\u25CF ${staleText}</span>
      </div>
    </div>`;
}

// ── Timeline ───────────────────────────────────────────────────────

async function renderTimeline(dealId) {
  const dealsEl = document.getElementById('pt-deals');
  const timelineEl = document.getElementById('pt-timeline');
  if (!dealsEl || !timelineEl) return;

  dealsEl.style.display = 'none';
  timelineEl.style.display = 'block';
  timelineEl.innerHTML = '<div class="pt-loading">Loading timeline...</div>';

  try {
    const deal = allDeals.find((d) => d.id === dealId);
    const response = await window.loopBackChrome.sendMessage({ type: 'get_messages', dealId });
    const messages = response?.messages || [];

    timelineEl.innerHTML = `
      <button class="pt-timeline-back">\u2190 Back to deals</button>
      <div class="pt-timeline-header">${escapeHtml(deal?.company || deal?.subject || 'Deal')}</div>
      <div class="pt-timeline-sub">${escapeHtml(deal?.contact_name || '')} \u00B7 ${deal?.deal_value ? formatCurrency(deal.deal_value) : 'No value'}</div>
      <div class="pt-timeline-events">
        ${messages.map((msg) => renderTimelineEvent(msg)).join('')}
      </div>`;

    timelineEl.querySelector('.pt-timeline-back').addEventListener('click', () => {
      timelineEl.style.display = 'none';
      dealsEl.style.display = 'flex';
    });
  } catch (err) {
    if (String(err?.message || '').includes('Extension context invalidated')) {
      window.loopBackChrome?.showReloadHint();
      timelineEl.innerHTML = '<div class="pt-empty">Refresh this tab to reconnect.</div>';
      return;
    }
    console.error('[LoopBack Sidebar] Error loading timeline:', err);
    timelineEl.innerHTML = '<div class="pt-empty">Error loading timeline</div>';
  }
}

function renderTimelineEvent(msg) {
  const date = new Date(msg.message_date);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const dirLabel = msg.direction === 'outbound' ? '\u2192 YOU' : '\u2190 THEM';
  const dirClass = msg.direction === 'outbound' ? 'outbound' : 'inbound';

  // Colored blip next to each message based on intent
  const blipColor = getIntentBlipColor(msg.intent);

  let promisedHtml = '';
  if (msg.promised_date) {
    const pd = new Date(msg.promised_date);
    const pdStr = pd.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    promisedHtml = `<div class="pt-timeline-promised">\uD83C\uDFF4 promised ${pdStr}</div>`;
  }

  return `
    <div class="pt-timeline-event pt-timeline-event--${dirClass}">
      <div class="pt-timeline-date">${dateStr}</div>
      <div class="pt-timeline-msg-row">
        <span class="pt-blip pt-blip--${blipColor}" title="${msg.intent}"></span>
        <span class="pt-timeline-direction pt-timeline-direction--${dirClass}">${dirLabel}</span>
        <span class="pt-timeline-intent">${msg.intent}</span>
      </div>
      <div class="pt-timeline-summary">${escapeHtml(msg.summary || '')}</div>
      ${promisedHtml}
    </div>`;
}

// ── Helpers ─────────────────────────────────────────────────────────

function setFilter(filter) {
  currentFilter = filter;
  renderFilters();
  renderDealCards(allDeals, currentFilter);
}

function getDirectionLabel(direction) {
  return direction === 'you_owe' ? 'You owe' : 'They owe';
}

function getTimingLabel(timing) {
  const labels = { active: 'Active', scheduled: 'Scheduled', stale: 'Stale' };
  return labels[timing] || timing;
}

/**
 * Map intent → blip color for the tiny colored dots next to each email.
 *   green  = positive signals (commit, agree)
 *   blue   = neutral/info (intro, info, ask, follow_up)
 *   red    = negative/delay (reject, defer)
 *   yellow = needs attention
 */
function getIntentBlipColor(intent) {
  switch (intent) {
    case 'commit':
    case 'agree':
      return 'green';
    case 'reject':
      return 'red';
    case 'defer':
      return 'orange';
    case 'ask':
    case 'follow_up':
      return 'yellow';
    case 'intro':
    case 'info':
    default:
      return 'blue';
  }
}

function formatCurrency(value) {
  const num = Number(value);
  if (isNaN(num) || num === 0) return '$0';
  if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `$${Math.round(num / 1000)}k`;
  return `$${num}`;
}

function formatStaleness(days) {
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

function getStalenessColor(days) {
  if (days <= 3) return 'green';
  if (days <= 7) return 'yellow';
  return 'red';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Message listeners & polling ────────────────────────────────────

window.loopBackChrome.onMessage((message) => {
  if (message.type === 'state_updated') {
    refreshSidebar();
  }
});

const _loopBackStatusPoll = setInterval(() => {
  if (!window.loopBackChrome?.isAlive()) {
    clearInterval(_loopBackStatusPoll);
    window.loopBackChrome?.showReloadHint();
    return;
  }
  updateScanStatusBar();
}, 3000);

(function waitForSidebar() {
  if (document.getElementById('pipeline-tracker-sidebar')) {
    refreshSidebar();
  } else {
    const obs = new MutationObserver(() => {
      if (document.getElementById('pipeline-tracker-sidebar')) {
        obs.disconnect();
        refreshSidebar();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }
})();

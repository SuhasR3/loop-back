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
          '<div class="pt-empty"><div class="pt-empty-text">Could not reach the extension. Refresh this Gmail tab (⌘R).</div></div>';
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
    statusEl.textContent = `⚠ ${data.scan_error}`;
    statusEl.style.color = 'var(--pt-red)';
  } else if (status === 'scanning') {
    statusEl.textContent = '⟳ Scanning…';
    statusEl.style.color = 'var(--pt-blue)';
  } else {
    const lastScan = data.last_scan_timestamp
      ? new Date(data.last_scan_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'never';
    statusEl.textContent = `Last scan: ${lastScan}`;
    statusEl.style.color = '';
  }
}

function renderBadges(counts) {
  const el = document.getElementById('pt-badges');
  if (!el) return;

  el.innerHTML = `
    <div class="pt-badge pt-badge--stale" data-filter="stale">
      <span class="pt-badge-count">${counts.stale || 0}</span>
      <span class="pt-badge-label">Stale</span>
    </div>
    <div class="pt-badge pt-badge--you-owe" data-filter="waiting_on_you">
      <span class="pt-badge-count">${counts.waiting_on_you || 0}</span>
      <span class="pt-badge-label">You Owe</span>
    </div>
    <div class="pt-badge pt-badge--they-owe" data-filter="waiting_on_them">
      <span class="pt-badge-count">${counts.waiting_on_them || 0}</span>
      <span class="pt-badge-label">They Owe</span>
    </div>
    <div class="pt-badge pt-badge--scheduled" data-filter="scheduled">
      <span class="pt-badge-count">${counts.scheduled || 0}</span>
      <span class="pt-badge-label">Scheduled</span>
    </div>
  `;

  el.querySelectorAll('.pt-badge').forEach((badge) => {
    badge.addEventListener('click', () => setFilter(badge.dataset.filter));
  });

  const outEl = document.getElementById('pt-outgoing-dues');
  const inEl = document.getElementById('pt-incoming-dues');
  if (outEl) {
    outEl.textContent = formatCurrency(counts.outgoing_dues_total || 0);
  }
  if (inEl) {
    inEl.textContent = formatCurrency(counts.incoming_dues_total || 0);
  }
}

function renderFilters() {
  const el = document.getElementById('pt-filters');
  if (!el) return;

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'stale', label: 'Stale' },
    { key: 'waiting_on_you', label: 'You Owe' },
    { key: 'waiting_on_them', label: 'They Owe' },
    { key: 'scheduled', label: 'Scheduled' },
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

function renderDealCards(deals, filter = 'all') {
  const el = document.getElementById('pt-deals');
  const timeline = document.getElementById('pt-timeline');
  if (!el) return;

  if (timeline) timeline.style.display = 'none';
  el.style.display = 'flex';

  const filtered =
    filter === 'all' ? deals.filter((d) => d.current_state !== 'dead' && d.current_state !== 'won') : deals.filter((d) => d.current_state === filter);

  if (filtered.length === 0) {
    el.innerHTML = `
      <div class="pt-empty">
        <div class="pt-empty-icon">📭</div>
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

  return `
    <div class="pt-deal-card" data-deal-id="${deal.id}">
      <div class="pt-deal-card-top">
        <span class="pt-deal-company">${escapeHtml(deal.company || deal.subject)}</span>
        <span class="pt-deal-value">${deal.deal_value ? formatCurrency(deal.deal_value) : ''}</span>
      </div>
      <div class="pt-deal-contact">${escapeHtml(deal.contact_name || '')}${deal.contact_name && deal.last_action_summary ? ' — ' : ''}${escapeHtml(deal.last_action_summary || '')}</div>
      <div class="pt-deal-bottom">
        <span class="pt-state-pill pt-state-pill--${deal.current_state}">${getStateBadgeLabel(deal.current_state)}</span>
        <span class="pt-staleness pt-staleness--${staleColor}">● ${staleText}</span>
      </div>
    </div>`;
}

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
      <button class="pt-timeline-back">← Back to deals</button>
      <div class="pt-timeline-header">${escapeHtml(deal?.company || deal?.subject || 'Deal')}</div>
      <div class="pt-timeline-sub">${escapeHtml(deal?.contact_name || '')} · ${deal?.deal_value ? formatCurrency(deal.deal_value) : 'No value'}</div>
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
  const dirLabel = msg.direction === 'outbound' ? '→ YOU' : '← THEM';
  const dirClass = msg.direction === 'outbound' ? 'outbound' : 'inbound';

  let promisedHtml = '';
  if (msg.promised_date) {
    const pd = new Date(msg.promised_date);
    const pdStr = pd.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    promisedHtml = `<div class="pt-timeline-promised">🏴 promised ${pdStr}</div>`;
  }

  return `
    <div class="pt-timeline-event pt-timeline-event--${dirClass}">
      <div class="pt-timeline-date">${dateStr}</div>
      <span class="pt-timeline-direction pt-timeline-direction--${dirClass}">${dirLabel}</span>
      <span class="pt-timeline-intent">${msg.intent}</span>
      <div class="pt-timeline-summary">${escapeHtml(msg.summary || '')}</div>
      ${promisedHtml}
    </div>`;
}

function setFilter(filter) {
  currentFilter = filter;
  renderFilters();
  renderDealCards(allDeals, currentFilter);
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
  return `${days}d stale`;
}

function getStalenessColor(days) {
  if (days <= 3) return 'green';
  if (days <= 7) return 'yellow';
  return 'red';
}

function getStateBadgeLabel(state) {
  const labels = {
    waiting_on_you: 'Waiting on you',
    waiting_on_them: 'Waiting on them',
    scheduled: 'Scheduled',
    stale: 'Stale',
    dead: 'Dead',
    won: 'Won',
  };
  return labels[state] || state;
}

function getStateColor(state) {
  const colors = {
    stale: 'var(--pt-red)',
    waiting_on_you: 'var(--pt-yellow)',
    waiting_on_them: 'var(--pt-green)',
    scheduled: 'var(--pt-blue)',
    dead: 'var(--pt-text-secondary)',
    won: 'var(--pt-green)',
  };
  return colors[state] || 'var(--pt-text-secondary)';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.loopBackChrome.onMessage((message) => {
  if (message.type === 'state_updated') {
    refreshSidebar();
  }
});

// Poll scan status every 3s so the header always reflects the real state
// even if the state_updated message is dropped
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

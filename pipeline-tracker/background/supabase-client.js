let supabaseUrl = '';
let supabaseKey = '';

export function initSupabase(url, anonKey) {
  supabaseUrl = url.replace(/\/$/, '');
  supabaseKey = anonKey;
}

async function query(table, { method = 'GET', filters = '', body = null, select = '*', order = '', single = false } = {}) {
  let url = `${supabaseUrl}/rest/v1/${table}?select=${select}`;
  if (filters) url += `&${filters}`;
  if (order) url += `&order=${order}`;

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    Prefer: method === 'POST' ? 'return=representation' : method === 'PATCH' ? 'return=representation' : '',
  };

  if (single) {
    headers['Accept'] = 'application/vnd.pgrst.object+json';
  }

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Supabase ${method} ${table}: ${resp.status} ${errText}`);
  }

  const text = await resp.text();
  if (!text) return null;
  return JSON.parse(text);
}

export async function getExistingDeal(threadId) {
  try {
    const result = await query('deals', {
      filters: `thread_id=eq.${encodeURIComponent(threadId)}`,
      single: true,
    });
    return result;
  } catch {
    return null;
  }
}

export async function isSkippedThread(threadId) {
  try {
    const result = await query('skipped_threads', {
      filters: `thread_id=eq.${encodeURIComponent(threadId)}`,
      single: true,
    });
    return !!result;
  } catch {
    return false;
  }
}

export async function skipThread(threadId) {
  await query('skipped_threads', {
    method: 'POST',
    body: { thread_id: threadId },
  });
}

export async function createDeal({ threadId, subject, contactName, contactEmail, company }) {
  const result = await query('deals', {
    method: 'POST',
    body: {
      thread_id: threadId,
      subject,
      contact_name: contactName,
      contact_email: contactEmail,
      company,
      current_state: 'waiting_on_them',
    },
  });
  const created = Array.isArray(result) ? result[0] : result;
  return parseDealState(created);
}

export async function addMessage({ dealId, gmailMessageId, direction, intent, summary, promisedDate, dealValue, messageDate }) {
  const result = await query('messages', {
    method: 'POST',
    body: {
      deal_id: dealId,
      gmail_message_id: gmailMessageId,
      direction,
      intent,
      summary,
      promised_date: promisedDate || null,
      deal_value: dealValue || null,
      message_date: messageDate,
    },
  });
  return Array.isArray(result) ? result[0] : result;
}

/**
 * The DB has a check constraint limiting current_state to the 6 legacy values:
 * waiting_on_you, waiting_on_them, stale, scheduled, dead, won.
 *
 * The state machine computes { direction, timing } independently, then maps
 * back to one of these for storage. On read, parseDealState() enriches each
 * deal with both dimensions so the UI can show them separately.
 */
export async function updateDealState(dealId, { currentState, direction, timing, terminal, stalenessDays, promisedDate, dealValue, lastActivityAt, lastActionSummary, needsResponse, urgent }) {
  await query('deals', {
    method: 'PATCH',
    filters: `id=eq.${encodeURIComponent(dealId)}`,
    body: {
      current_state: currentState,
      staleness_days: stalenessDays,
      promised_date: promisedDate || null,
      deal_value: dealValue,
      last_activity_at: lastActivityAt,
      last_action_summary: lastActionSummary,
      needs_response: needsResponse || false,
      updated_at: new Date().toISOString(),
    },
  });
}

/**
 * Parse the composite current_state back into { direction, timing, terminal, urgent }.
 * Called after fetching deals so the sidebar/popup can use both dimensions.
 *
 * Handles:
 *   "you_owe__stale"       → { direction: "you_owe", timing: "stale", terminal: null }
 *   "they_owe__scheduled"  → { direction: "they_owe", timing: "scheduled", terminal: null }
 *   "dead"                 → { direction: null, timing: null, terminal: "dead" }
 *   "won"                  → { direction: null, timing: null, terminal: "won" }
 *   Legacy: "waiting_on_you" → { direction: "you_owe", timing: "active", terminal: null }
 *   Legacy: "waiting_on_them" → { direction: "they_owe", timing: "active", terminal: null }
 *   Legacy: "stale"        → { direction: "they_owe", timing: "stale", terminal: null }
 *   Legacy: "scheduled"    → { direction: "they_owe", timing: "scheduled", terminal: null }
 */
export function parseDealState(deal) {
  const cs = deal.current_state || '';

  // Terminal states
  if (cs === 'dead') return { ...deal, direction: null, timing: null, terminal: 'dead', urgent: false };
  if (cs === 'won')  return { ...deal, direction: null, timing: null, terminal: 'won', urgent: false };

  // New composite format: "direction__timing"
  if (cs.includes('__')) {
    const [direction, timing] = cs.split('__');
    const urgent = direction === 'you_owe' && (deal.staleness_days > 3 || timing === 'stale');
    return { ...deal, direction, timing, terminal: null, urgent };
  }

  // DB enum values — infer direction from needs_response flag when timing dominates
  const nr = deal.needs_response;
  const sd = deal.staleness_days || 0;
  switch (cs) {
    case 'waiting_on_you':
    case 'you_owe':
      return { ...deal, direction: 'you_owe', timing: sd >= 14 ? 'stale' : 'active', terminal: null, urgent: sd > 3 };
    case 'waiting_on_them':
    case 'they_owe':
      return { ...deal, direction: 'they_owe', timing: sd >= 14 ? 'stale' : 'active', terminal: null, urgent: false };
    case 'stale':
      return { ...deal, direction: nr ? 'you_owe' : 'they_owe', timing: 'stale', terminal: null, urgent: !!nr };
    case 'scheduled':
      return { ...deal, direction: nr ? 'you_owe' : 'they_owe', timing: 'scheduled', terminal: null, urgent: false };
    default:
      return { ...deal, direction: 'they_owe', timing: 'active', terminal: null, urgent: false };
  }
}

export async function getAllDeals() {
  const result = await query('deals', {
    order: 'last_activity_at.desc',
  });
  // Hydrate every deal with the parsed direction/timing/terminal fields
  return (result || []).map(parseDealState);
}

export async function getMessagesForDeal(dealId) {
  const result = await query('messages', {
    filters: `deal_id=eq.${encodeURIComponent(dealId)}`,
    order: 'message_date.asc',
  });
  return result || [];
}

export async function getDealCounts() {
  const deals = await getAllDeals();
  const counts = {
    // Direction counts
    you_owe: 0,
    they_owe: 0,
    // Timing counts
    active: 0,
    scheduled: 0,
    stale: 0,
    // Terminal counts
    dead: 0,
    won: 0,
    // Pipeline value by direction
    outgoing_dues_total: 0,
    incoming_dues_total: 0,
    // Urgent count (you_owe + stale or 3+ days)
    urgent: 0,
  };

  for (const deal of deals) {
    const raw = deal.deal_value;
    const v = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    const val = Number.isFinite(v) ? v : 0;

    // Terminal states
    if (deal.terminal === 'dead') { counts.dead++; continue; }
    if (deal.terminal === 'won') { counts.won++; continue; }

    // Direction dimension
    if (deal.direction === 'you_owe') {
      counts.you_owe++;
      counts.outgoing_dues_total += val;
    } else if (deal.direction === 'they_owe') {
      counts.they_owe++;
      counts.incoming_dues_total += val;
    }

    // Timing dimension
    if (deal.timing === 'stale') counts.stale++;
    else if (deal.timing === 'scheduled') counts.scheduled++;
    else counts.active++;

    // Urgent
    if (deal.urgent) counts.urgent++;
  }

  return counts;
}

export async function getExistingMessages(dealId) {
  const result = await query('messages', {
    filters: `deal_id=eq.${encodeURIComponent(dealId)}`,
    select: 'gmail_message_id',
  });
  return (result || []).map((m) => m.gmail_message_id);
}

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
  return Array.isArray(result) ? result[0] : result;
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

export async function updateDealState(dealId, { currentState, stalenessDays, promisedDate, dealValue, lastActivityAt, lastActionSummary, needsResponse }) {
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

export async function getAllDeals() {
  const result = await query('deals', {
    order: 'staleness_days.desc',
  });
  return result || [];
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
    stale: 0,
    waiting_on_you: 0,
    waiting_on_them: 0,
    scheduled: 0,
    /** Sum of deal_value where we owe the next step */
    outgoing_dues_total: 0,
    /** Sum of deal_value where they owe the next step */
    incoming_dues_total: 0,
  };

  for (const deal of deals) {
    const raw = deal.deal_value;
    const v = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    const val = Number.isFinite(v) ? v : 0;

    switch (deal.current_state) {
      case 'stale':
        counts.stale++;
        break;
      case 'waiting_on_you':
        counts.waiting_on_you++;
        counts.outgoing_dues_total += val;
        break;
      case 'waiting_on_them':
        counts.waiting_on_them++;
        counts.incoming_dues_total += val;
        break;
      case 'scheduled':
        counts.scheduled++;
        // Scheduled follow-ups still carry pipeline $ — count toward both buckets when value is set
        if (val > 0) {
          counts.outgoing_dues_total += val;
          counts.incoming_dues_total += val;
        }
        break;
      default:
        break;
    }
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

/**
 * State Machine v2 — Two independent dimensions per deal:
 *
 *   1. Direction  — who owes the next reply:
 *        "you_owe"   (latest relevant signal says ball is in YOUR court)
 *        "they_owe"  (latest relevant signal says ball is in THEIR court)
 *
 *   2. Timing     — is the deal on schedule:
 *        "active"    (normal cadence, nothing overdue)
 *        "scheduled" (there's a future promised_date we're waiting for)
 *        "stale"     (a promised_date has passed, OR no activity for 14+ days)
 *
 *   Terminal states (override both dimensions):
 *        "dead"  — latest inbound message was a reject
 *        "won"   — latest inbound message was a commit
 *
 * The old code conflated these into a single `state` field.
 * Now we return { direction, timing, terminal } so the UI can
 * combine them however it wants, plus a legacy `state` string
 * for backwards compat with the DB schema.
 */

export function computeState(messages, currentDate = new Date()) {
  if (!messages || messages.length === 0) {
    return {
      direction: 'they_owe',
      timing: 'active',
      terminal: null,
      state: 'waiting_on_them',              // DB-safe enum value
      staleness_days: 0,
      promised_date: null,
      deal_value: null,
      last_activity: currentDate.toISOString(),
      last_action_summary: 'No messages',
    };
  }

  const sorted = [...messages].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const latest = sorted[sorted.length - 1];
  const latestDate = new Date(latest.date);
  const daysSinceLatest = daysBetween(latestDate, currentDate);

  const dealValue = extractLatestDealValue(sorted);
  const lastActionSummary = latest.summary || latest.intent || '';

  // ── Terminal states (override everything) ────────────────────────
  if (latest.intent === 'reject' && latest.direction === 'inbound') {
    return {
      direction: null,
      timing: null,
      terminal: 'dead',
      state: 'dead',
      staleness_days: daysSinceLatest,
      promised_date: latest.promised_date || null,
      deal_value: dealValue,
      last_activity: latestDate.toISOString(),
      last_action_summary: lastActionSummary,
    };
  }

  if (latest.intent === 'commit' && latest.direction === 'inbound') {
    return {
      direction: null,
      timing: null,
      terminal: 'won',
      state: 'won',
      staleness_days: 0,
      promised_date: null,
      deal_value: dealValue,
      last_activity: latestDate.toISOString(),
      last_action_summary: lastActionSummary,
    };
  }

  // ── Dimension 1: Direction ───────────────────────────────────────
  // Who owes the next reply?
  // Inbound (they wrote to us) → ball is in our court → you_owe
  // Outbound (we wrote to them) → ball is in their court → they_owe
  const direction = latest.direction === 'inbound' ? 'you_owe' : 'they_owe';

  // ── Dimension 2: Timing ──────────────────────────────────────────
  let timing = 'active';
  let promisedDate = null;

  // Check for the most recent inbound defer with a promised date
  const latestInboundDefer = findLatestInboundDefer(sorted);
  if (latestInboundDefer && latestInboundDefer.promised_date) {
    const pd = new Date(latestInboundDefer.promised_date);
    promisedDate = latestInboundDefer.promised_date;

    if (pd > currentDate) {
      // Promised date is in the future → scheduled
      timing = 'scheduled';
    } else {
      // Promised date has passed → stale
      timing = 'stale';
    }
  }

  // Staleness override: no activity for 14+ days → stale regardless
  if (timing !== 'stale' && daysSinceLatest >= 14) {
    timing = 'stale';
  }

  // Urgent flag: you_owe + 3+ days without response
  const urgent = direction === 'you_owe' && daysSinceLatest > 3;

  // Map to a DB-safe enum value (the check constraint only allows the 6 legacy values).
  // Priority: timing trumps direction when stale/scheduled (they're more actionable).
  // Otherwise fall back to direction.
  let dbState;
  if (timing === 'stale')     dbState = 'stale';
  else if (timing === 'scheduled') dbState = 'scheduled';
  else if (direction === 'you_owe') dbState = 'waiting_on_you';
  else                         dbState = 'waiting_on_them';

  return {
    direction,
    timing,
    terminal: null,
    state: dbState,
    staleness_days: daysSinceLatest,
    promised_date: promisedDate,
    deal_value: dealValue,
    last_activity: latestDate.toISOString(),
    last_action_summary: lastActionSummary,
    urgent,
  };
}

function daysBetween(dateA, dateB) {
  const msPerDay = 86400000;
  return Math.floor(Math.abs(dateB - dateA) / msPerDay);
}

function extractLatestDealValue(sortedMessages) {
  for (let i = sortedMessages.length - 1; i >= 0; i--) {
    if (sortedMessages[i].deal_value != null) {
      return sortedMessages[i].deal_value;
    }
  }
  return null;
}

function findLatestInboundDefer(sortedMessages) {
  for (let i = sortedMessages.length - 1; i >= 0; i--) {
    const msg = sortedMessages[i];
    if (msg.direction === 'inbound' && msg.intent === 'defer') {
      return msg;
    }
  }
  return null;
}

export function computeState(messages, currentDate = new Date()) {
  if (!messages || messages.length === 0) {
    return {
      state: 'waiting_on_them',
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

  // Rule 1: most recent inbound reject → dead
  if (latest.intent === 'reject' && latest.direction === 'inbound') {
    return {
      state: 'dead',
      staleness_days: daysSinceLatest,
      promised_date: latest.promised_date || null,
      deal_value: dealValue,
      last_activity: latestDate.toISOString(),
      last_action_summary: lastActionSummary,
    };
  }

  // Rule 2: most recent inbound commit → won
  if (latest.intent === 'commit' && latest.direction === 'inbound') {
    return {
      state: 'won',
      staleness_days: 0,
      promised_date: null,
      deal_value: dealValue,
      last_activity: latestDate.toISOString(),
      last_action_summary: lastActionSummary,
    };
  }

  // Rule 3: most recent inbound defer with promised_date
  const latestInboundDefer = findLatestInboundDefer(sorted);
  if (latestInboundDefer && latestInboundDefer.promised_date) {
    const promisedDate = new Date(latestInboundDefer.promised_date);
    if (promisedDate > currentDate) {
      return {
        state: 'scheduled',
        staleness_days: 0,
        promised_date: latestInboundDefer.promised_date,
        deal_value: dealValue,
        last_activity: latestDate.toISOString(),
        last_action_summary: lastActionSummary,
      };
    } else {
      return {
        state: 'stale',
        staleness_days: daysBetween(promisedDate, currentDate),
        promised_date: latestInboundDefer.promised_date,
        deal_value: dealValue,
        last_activity: latestDate.toISOString(),
        last_action_summary: lastActionSummary,
      };
    }
  }

  // Rule 6 (checked before 4/5): staleness override — no messages in 14 days
  if (daysSinceLatest >= 14) {
    return {
      state: 'stale',
      staleness_days: daysSinceLatest,
      promised_date: null,
      deal_value: dealValue,
      last_activity: latestDate.toISOString(),
      last_action_summary: lastActionSummary,
    };
  }

  // Rule 4: most recent message is inbound → waiting_on_you
  if (latest.direction === 'inbound') {
    return {
      state: 'waiting_on_you',
      staleness_days: daysSinceLatest,
      promised_date: null,
      deal_value: dealValue,
      last_activity: latestDate.toISOString(),
      last_action_summary: lastActionSummary,
      urgent: daysSinceLatest > 3,
    };
  }

  // Rule 5: most recent message is outbound → waiting_on_them
  return {
    state: 'waiting_on_them',
    staleness_days: daysSinceLatest,
    promised_date: null,
    deal_value: dealValue,
    last_activity: latestDate.toISOString(),
    last_action_summary: lastActionSummary,
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

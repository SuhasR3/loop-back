/**
 * Demo data seeder for Pipeline Tracker v2 (dual-dimension state model).
 * Run with: node seed-demo-data.js
 *
 * Set environment variables or edit the constants below:
 *   SUPABASE_URL=https://your-project.supabase.co
 *   SUPABASE_ANON_KEY=your-anon-key
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'your-anon-key';

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function supabasePost(table, body) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`POST ${table} failed: ${resp.status} ${err}`);
  }
  return resp.json();
}

async function supabaseDelete(table) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=not.is.null`, {
    method: 'DELETE',
    headers: { ...headers, Prefer: '' },
  });
}

/**
 * Deals now have TWO independent dimensions:
 *   direction: "you_owe" | "they_owe"
 *   timing:    "active" | "scheduled" | "stale"
 *   terminal:  null | "dead" | "won"
 *
 * current_state = composite string like "they_owe__stale" for backwards compat.
 */

const DEALS = [
  {
    thread_id: 'demo_bolt_dynamics',
    subject: 'Re: Partnership opportunity — Bolt Dynamics x Loop Back',
    contact_name: 'Sam Reyes',
    contact_email: 'sam.reyes@boltdynamics.com',
    company: 'Bolt Dynamics',
    deal_value: 36000,
    current_state: 'they_owe__stale',
    staleness_days: 14,
    last_activity_at: daysAgo(14),
    last_action_summary: 'Review deck and respond',
    needs_response: false,
    messages: [
      { gmail_message_id: 'bolt_1', direction: 'outbound', intent: 'intro', summary: 'Introduced Loop Back platform after webinar', message_date: daysAgo(30) },
      { gmail_message_id: 'bolt_2', direction: 'inbound', intent: 'ask', summary: 'Requested product deck and pricing', message_date: daysAgo(25) },
      { gmail_message_id: 'bolt_3', direction: 'outbound', intent: 'info', summary: 'Sent product deck with enterprise pricing', message_date: daysAgo(21) },
      { gmail_message_id: 'bolt_4', direction: 'inbound', intent: 'defer', summary: 'Review deck and respond', message_date: daysAgo(14), deal_value: 36000 },
    ],
  },
  {
    thread_id: 'demo_acme_robotics',
    subject: 'Re: Following up from SaaStr — Acme Robotics',
    contact_name: 'Derek Chen',
    contact_email: 'derek.chen@acmerobotics.com',
    company: 'Acme Robotics',
    deal_value: 48000,
    current_state: 'they_owe__stale',
    staleness_days: 5,
    promised_date: daysAgoDate(6),
    last_activity_at: daysAgo(5),
    last_action_summary: 'Let me run this by my co-founder',
    needs_response: false,
    messages: [
      { gmail_message_id: 'acme_1', direction: 'outbound', intent: 'intro', summary: 'Reached out after our chat at SaaStr', message_date: '2026-03-22T10:00:00Z' },
      { gmail_message_id: 'acme_2', direction: 'inbound', intent: 'ask', summary: 'Can you send pricing for the enterprise tier?', message_date: '2026-03-28T14:30:00Z' },
      { gmail_message_id: 'acme_3', direction: 'outbound', intent: 'commit', summary: 'Sent proposal + pricing breakdown', message_date: '2026-03-29T09:15:00Z', deal_value: 48000 },
      { gmail_message_id: 'acme_4', direction: 'inbound', intent: 'defer', summary: 'Let me run this by my co-founder, circle back Friday', message_date: '2026-04-04T16:00:00Z', promised_date: '2026-04-05' },
    ],
  },
  {
    thread_id: 'demo_novatech',
    subject: 'Re: NovaTech — SOW discussion',
    contact_name: 'Lisa Park',
    contact_email: 'lisa.park@novatech.io',
    company: 'NovaTech',
    deal_value: 120000,
    current_state: 'you_owe__active',
    staleness_days: 1,
    last_activity_at: daysAgo(1),
    last_action_summary: 'Can you send the SOW?',
    needs_response: true,
    messages: [
      { gmail_message_id: 'nova_1', direction: 'outbound', intent: 'intro', summary: 'Initial outreach about enterprise solution', message_date: daysAgo(15) },
      { gmail_message_id: 'nova_2', direction: 'inbound', intent: 'agree', summary: 'Interested, lets set up a call', message_date: daysAgo(12) },
      { gmail_message_id: 'nova_3', direction: 'outbound', intent: 'info', summary: 'Call summary and next steps', message_date: daysAgo(8), deal_value: 120000 },
      { gmail_message_id: 'nova_4', direction: 'inbound', intent: 'ask', summary: 'Can you send the SOW?', message_date: daysAgo(1) },
    ],
  },
  {
    thread_id: 'demo_meridian',
    subject: 'Re: Meridian Labs — Q2 renewal',
    contact_name: 'Raj Patel',
    contact_email: 'raj.patel@meridianlabs.com',
    company: 'Meridian Labs',
    deal_value: 24000,
    current_state: 'they_owe__scheduled',
    staleness_days: 0,
    promised_date: futureDate(4),
    last_activity_at: daysAgo(3),
    last_action_summary: 'Let\'s reconnect Apr 15',
    needs_response: false,
    messages: [
      { gmail_message_id: 'merid_1', direction: 'outbound', intent: 'follow_up', summary: 'Checking in on Q2 renewal', message_date: daysAgo(10) },
      { gmail_message_id: 'merid_2', direction: 'inbound', intent: 'agree', summary: 'Definitely want to renew, need budget sign-off', message_date: daysAgo(7), deal_value: 24000 },
      { gmail_message_id: 'merid_3', direction: 'inbound', intent: 'defer', summary: 'Let\'s reconnect Apr 15', message_date: daysAgo(3), promised_date: futureDate(4) },
    ],
  },
  {
    thread_id: 'demo_syncwave',
    subject: 'Re: SyncWave — platform demo follow-up',
    contact_name: 'Maria Torres',
    contact_email: 'maria@syncwave.co',
    company: 'SyncWave',
    deal_value: 85000,
    current_state: 'they_owe__stale',
    staleness_days: 21,
    last_activity_at: daysAgo(21),
    last_action_summary: 'Sounds interesting, let me think',
    needs_response: false,
    messages: [
      { gmail_message_id: 'sync_1', direction: 'outbound', intent: 'intro', summary: 'Demo follow-up with proposal', message_date: daysAgo(28) },
      { gmail_message_id: 'sync_2', direction: 'inbound', intent: 'ask', summary: 'What integrations do you support?', message_date: daysAgo(25) },
      { gmail_message_id: 'sync_3', direction: 'outbound', intent: 'info', summary: 'Full integration list and pricing', message_date: daysAgo(23), deal_value: 85000 },
      { gmail_message_id: 'sync_4', direction: 'inbound', intent: 'defer', summary: 'Sounds interesting, let me think', message_date: daysAgo(21) },
    ],
  },
  {
    thread_id: 'demo_atlas',
    subject: 'Re: Atlas Corp — Enterprise proposal',
    contact_name: 'James Wong',
    contact_email: 'jwong@atlascorp.com',
    company: 'Atlas Corp',
    deal_value: 200000,
    current_state: 'they_owe__active',
    staleness_days: 8,
    last_activity_at: daysAgo(8),
    last_action_summary: 'Sent proposal + pricing',
    needs_response: false,
    messages: [
      { gmail_message_id: 'atlas_1', direction: 'inbound', intent: 'ask', summary: 'Inquiry about enterprise platform', message_date: daysAgo(20) },
      { gmail_message_id: 'atlas_2', direction: 'outbound', intent: 'info', summary: 'Scheduled discovery call', message_date: daysAgo(18) },
      { gmail_message_id: 'atlas_3', direction: 'outbound', intent: 'commit', summary: 'Sent proposal + pricing', message_date: daysAgo(8), deal_value: 200000 },
    ],
  },
  {
    thread_id: 'demo_pinnacle',
    subject: 'Re: Pinnacle AI — vendor evaluation',
    contact_name: 'Sarah Kim',
    contact_email: 'sarah.kim@pinnacle.ai',
    company: 'Pinnacle AI',
    deal_value: 15000,
    current_state: 'dead',
    staleness_days: 30,
    last_activity_at: daysAgo(30),
    last_action_summary: 'Going with another vendor',
    needs_response: false,
    messages: [
      { gmail_message_id: 'pinn_1', direction: 'outbound', intent: 'intro', summary: 'Intro and pitch for AI platform', message_date: daysAgo(45) },
      { gmail_message_id: 'pinn_2', direction: 'inbound', intent: 'ask', summary: 'Requested trial and pricing info', message_date: daysAgo(40), deal_value: 15000 },
      { gmail_message_id: 'pinn_3', direction: 'outbound', intent: 'info', summary: 'Sent trial access and pricing', message_date: daysAgo(35) },
      { gmail_message_id: 'pinn_4', direction: 'inbound', intent: 'reject', summary: 'Going with another vendor', message_date: daysAgo(30) },
    ],
  },
  {
    thread_id: 'demo_horizon',
    subject: 'Re: Horizon SaaS — budget discussion',
    contact_name: 'Mike Chen',
    contact_email: 'mike.chen@horizonsaas.com',
    company: 'Horizon SaaS',
    deal_value: 65000,
    current_state: 'they_owe__stale',
    staleness_days: 10,
    last_activity_at: daysAgo(10),
    last_action_summary: 'Need to get budget approval',
    needs_response: false,
    messages: [
      { gmail_message_id: 'horiz_1', direction: 'outbound', intent: 'intro', summary: 'Outreach after conference meetup', message_date: daysAgo(22) },
      { gmail_message_id: 'horiz_2', direction: 'inbound', intent: 'agree', summary: 'Very interested in the platform', message_date: daysAgo(18) },
      { gmail_message_id: 'horiz_3', direction: 'outbound', intent: 'info', summary: 'Pricing breakdown for team of 50', message_date: daysAgo(15), deal_value: 65000 },
      { gmail_message_id: 'horiz_4', direction: 'inbound', intent: 'defer', summary: 'Need to get budget approval', message_date: daysAgo(10) },
    ],
  },
  {
    thread_id: 'demo_cloudforge',
    subject: 'Re: CloudForge — implementation timeline',
    contact_name: 'Anna Lee',
    contact_email: 'anna@cloudforge.dev',
    company: 'CloudForge',
    deal_value: 42000,
    current_state: 'you_owe__active',
    staleness_days: 0,
    last_activity_at: daysAgo(0),
    last_action_summary: 'What\'s your implementation timeline?',
    needs_response: true,
    messages: [
      { gmail_message_id: 'cloud_1', direction: 'inbound', intent: 'ask', summary: 'Inquiry about custom implementation', message_date: daysAgo(7) },
      { gmail_message_id: 'cloud_2', direction: 'outbound', intent: 'info', summary: 'Standard vs custom implementation details', message_date: daysAgo(5), deal_value: 42000 },
      { gmail_message_id: 'cloud_3', direction: 'inbound', intent: 'agree', summary: 'Custom approach looks great', message_date: daysAgo(2) },
      { gmail_message_id: 'cloud_4', direction: 'inbound', intent: 'ask', summary: 'What\'s your implementation timeline?', message_date: daysAgo(0) },
    ],
  },
  {
    thread_id: 'demo_vertex',
    subject: 'Re: Vertex Labs — team expansion',
    contact_name: 'Tom Brown',
    contact_email: 'tom.brown@vertexlabs.io',
    company: 'Vertex Labs',
    deal_value: 90000,
    current_state: 'you_owe__stale',
    staleness_days: 7,
    last_activity_at: daysAgo(7),
    last_action_summary: 'Will discuss internally this week',
    needs_response: true,
    messages: [
      { gmail_message_id: 'vert_1', direction: 'outbound', intent: 'follow_up', summary: 'Follow-up on expansion discussion', message_date: daysAgo(14) },
      { gmail_message_id: 'vert_2', direction: 'inbound', intent: 'agree', summary: 'Team is growing, need to scale', message_date: daysAgo(12), deal_value: 90000 },
      { gmail_message_id: 'vert_3', direction: 'outbound', intent: 'info', summary: 'Sent scaling proposal and timeline', message_date: daysAgo(10) },
      { gmail_message_id: 'vert_4', direction: 'inbound', intent: 'defer', summary: 'Will discuss internally this week', message_date: daysAgo(7) },
    ],
  },
];

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function daysAgoDate(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function futureDate(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

async function seed() {
  console.log('Clearing existing data...');
  await supabaseDelete('messages');
  await supabaseDelete('deals');
  await supabaseDelete('skipped_threads');

  console.log('Seeding deals and messages...');

  for (const deal of DEALS) {
    const { messages, ...dealData } = deal;

    const [created] = await supabasePost('deals', dealData);
    console.log(`  \u2713 Deal: ${dealData.company} (${dealData.current_state})`);

    for (const msg of messages) {
      await supabasePost('messages', {
        ...msg,
        deal_id: created.id,
      });
    }
    console.log(`    \u2192 ${messages.length} messages`);
  }

  console.log('\nDone! Seeded 10 deals with messages.');
  console.log('State summary (direction / timing):');
  console.log('  they_owe + stale:     Bolt Dynamics, Acme Robotics, SyncWave, Horizon SaaS');
  console.log('  they_owe + active:    Atlas Corp');
  console.log('  they_owe + scheduled: Meridian Labs');
  console.log('  you_owe + active:     NovaTech, CloudForge');
  console.log('  you_owe + stale:      Vertex Labs (URGENT)');
  console.log('  dead:                 Pinnacle AI');
}

seed().catch(console.error);

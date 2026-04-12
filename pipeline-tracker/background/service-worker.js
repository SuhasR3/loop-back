import { getAuthToken, getRecentThreadIds, getThread, parseSender, getDirection, getUserEmail } from './gmail-api.js';
import { isBlacklisted, seedDefaultBlacklist } from './blacklist-filter.js';
import { classifyIsDeal, classifyMessage } from './llm-classifier.js';
import { computeState } from './state-machine.js';
import {
  initSupabase, getExistingDeal, isSkippedThread, skipThread,
  createDeal, addMessage, updateDealState, getAllDeals,
  getMessagesForDeal, getDealCounts, getExistingMessages,
} from './supabase-client.js';

const CONFIG = {
  GROQ_API_KEY: '',          // Set via extension popup or chrome.storage.local
  SUPABASE_URL: '',           // Set via extension popup or chrome.storage.local
  SUPABASE_ANON_KEY: '',      // Set via extension popup or chrome.storage.local
  SCAN_DEBOUNCE_SECONDS: 60,
  PERIODIC_SCAN_MINUTES: 5,
  STALE_THRESHOLD_DAYS: 7,
  /** Inbox threads to consider per scan (each new thread uses 1 Groq call for classifyIsDeal; deals add more calls per message). */
  MAX_THREADS_PER_SCAN: 20,
  MAX_MESSAGES_PER_SCAN: 50,
  MAX_THREAD_DEPTH: 20,
};

let gmailTabVisible = false;
let scanInProgress = false;

async function getConfig() {
  const stored = await chrome.storage.local.get(['groq_api_key', 'gemini_api_key', 'supabase_url', 'supabase_anon_key']);
  return {
    GROQ_API_KEY: stored.groq_api_key || stored.gemini_api_key || CONFIG.GROQ_API_KEY,
    SUPABASE_URL: stored.supabase_url || CONFIG.SUPABASE_URL,
    SUPABASE_ANON_KEY: stored.supabase_anon_key || CONFIG.SUPABASE_ANON_KEY,
  };
}

async function ensureSupabase() {
  const cfg = await getConfig();
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    console.warn('[LoopBack] Supabase not configured');
    return false;
  }
  initSupabase(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  return true;
}

async function shouldDebounce() {
  const data = await chrome.storage.local.get('last_scan_timestamp');
  if (!data.last_scan_timestamp) return false;
  const elapsed = (Date.now() - data.last_scan_timestamp) / 1000;
  return elapsed < CONFIG.SCAN_DEBOUNCE_SECONDS;
}

async function setScanStatus(status, error = null) {
  await chrome.storage.local.set({
    scan_status: status,
    scan_error: error,
    scan_status_at: Date.now(),
  });
}

async function runScanPipeline() {
  if (scanInProgress) {
    console.log('[LoopBack] Scan already in progress, skipping');
    return;
  }

  if (await shouldDebounce()) {
    console.log('[LoopBack] Debounced — last scan was too recent');
    return;
  }

  scanInProgress = true;
  await setScanStatus('scanning');
  console.log('[LoopBack] Scan started');

  const scanTimeout = setTimeout(async () => {
    if (scanInProgress) {
      console.error('[LoopBack] Scan timed out after 180s');
      await setScanStatus('error', 'Scan timed out after 180s — check service worker console for details');
      scanInProgress = false;
    }
  }, 180000);

  try {
    const cfg = await getConfig();
    const keyMeta = await chrome.storage.local.get(['groq_api_key', 'gemini_api_key']);
    const keyFromPopup = !!(keyMeta.groq_api_key || keyMeta.gemini_api_key);
    console.log(
      `[LoopBack] Groq API key source: ${keyFromPopup ? 'Extension popup (overrides CONFIG)' : 'service-worker.js CONFIG'}`
    );
    if (!cfg.GROQ_API_KEY) {
      await setScanStatus('error', 'Groq API key not configured. Get one at console.groq.com/keys and enter it in the popup.');
      console.warn('[LoopBack] Groq API key not configured');
      return;
    }

    if (!(await ensureSupabase())) {
      await setScanStatus('error', 'Supabase not configured. Enter URL and anon key in popup settings.');
      return;
    }

    let token;
    try {
      token = await getAuthToken();
    } catch (authErr) {
      const msg = authErr.message || String(authErr);
      console.error('[LoopBack] getAuthToken failed:', msg);
      await setScanStatus('error', `Gmail auth failed: ${msg}`);
      return;
    }

    const userEmail = await getUserEmail(token);

    console.log('[LoopBack] ① Fetching thread list from Gmail…');
    const allThreadIds = await getRecentThreadIds(token, 30);
    const threadIds = allThreadIds.slice(0, CONFIG.MAX_THREADS_PER_SCAN);
    console.log(`[LoopBack] ② Got ${allThreadIds.length} threads, processing ${threadIds.length}`);

    let messagesProcessed = 0;

    for (const threadId of threadIds) {
      if (messagesProcessed >= CONFIG.MAX_MESSAGES_PER_SCAN) {
        console.log('[LoopBack] Rate limit reached, queuing rest for next cycle');
        break;
      }

      console.log(`[LoopBack] ③ Checking thread ${threadId}…`);

      if (await isSkippedThread(threadId)) {
        console.log(`[LoopBack]    → already skipped, skipping`);
        continue;
      }

      let threadData;
      try {
        console.log(`[LoopBack]    → fetching full thread…`);
        threadData = await getThread(token, threadId);
        console.log(`[LoopBack]    → subject: "${threadData.subject}", ${threadData.messages.length} messages`);
      } catch (err) {
        if (err.message === 'AUTH_EXPIRED') {
          chrome.identity.removeCachedAuthToken({ token }, () => {});
          await setScanStatus('error', 'Gmail token expired. Reload the extension and try again.');
          console.error('[LoopBack] Auth expired, need re-auth');
          return;
        }
        console.error(`[LoopBack] Error fetching thread ${threadId}:`, err);
        continue;
      }

      if (!threadData.messages || threadData.messages.length === 0) {
        console.log(`[LoopBack]    → no messages, skipping`);
        continue;
      }

      const sender = parseSender(threadData.messages[0]);
      console.log(`[LoopBack]    → sender: ${sender.email}`);

      if (await isBlacklisted(sender.email)) {
        console.log(`[LoopBack]    → BLACKLISTED, skipping`);
        await skipThread(threadId).catch(() => {});
        continue;
      }

      let existingDeal = await getExistingDeal(threadId);

      if (!existingDeal) {
        console.log(`[LoopBack] ④ New thread — calling Groq to classify as deal…`);
        const messageBodies = threadData.messages.slice(0, 3).map((m) => m.bodyText);
        const classification = await classifyIsDeal(cfg.GROQ_API_KEY, threadData.subject, messageBodies);
        messagesProcessed++;
        console.log(`[LoopBack]    → isDeal: ${classification.isDeal}, company: ${classification.company}`);

        if (!classification.isDeal) {
          console.log(`[LoopBack]    → Not a deal, skipping thread`);
          await skipThread(threadId).catch(() => {});
          continue;
        }

        console.log(`[LoopBack]    → IS a deal! Creating deal record…`);
        existingDeal = await createDeal({
          threadId,
          subject: threadData.subject,
          contactName: classification.contactName,
          contactEmail: classification.contactEmail || sender.email,
          company: classification.company,
        });
        console.log(`[LoopBack]    → Deal created: ${existingDeal.id}`);
      } else {
        console.log(`[LoopBack]    → Already tracked deal: ${existingDeal.company || existingDeal.subject}`);
      }

      const existingMsgIds = await getExistingMessages(existingDeal.id);
      let messages = threadData.messages;

      if (messages.length > 50) {
        messages = messages.slice(-CONFIG.MAX_THREAD_DEPTH);
      }

      const newMessages = messages.filter((m) => !existingMsgIds.includes(m.id));
      console.log(`[LoopBack] ⑤ ${newMessages.length} new messages to classify (${existingMsgIds.length} already stored)`);
      if (newMessages.length === 0) continue;

      const previousMsgs = messages
        .filter((m) => existingMsgIds.includes(m.id))
        .map((m) => ({
          date: m.date,
          direction: getDirection(m, userEmail),
          sender: parseSender(m).name || parseSender(m).email,
          snippet: m.snippet,
        }));

      for (const msg of newMessages) {
        if (messagesProcessed >= CONFIG.MAX_MESSAGES_PER_SCAN) break;

        const direction = getDirection(msg, userEmail);
        console.log(`[LoopBack]    → classifying message ${msg.id} (${direction})…`);
        try {
          const classified = await classifyMessage(
            cfg.GROQ_API_KEY,
            msg.bodyText,
            direction,
            threadData.subject,
            previousMsgs
          );
          console.log(`[LoopBack]    → intent: ${classified.intent}, summary: "${classified.summary}"`);

          await addMessage({
            dealId: existingDeal.id,
            gmailMessageId: msg.id,
            direction,
            intent: classified.intent,
            summary: classified.summary,
            promisedDate: classified.promised_date,
            dealValue: classified.deal_value,
            messageDate: msg.date,
          });

          previousMsgs.push({
            date: msg.date,
            direction,
            sender: parseSender(msg).name || parseSender(msg).email,
            snippet: msg.snippet,
          });

          messagesProcessed++;
        } catch (err) {
          console.error(`[LoopBack] Error classifying message ${msg.id}:`, err);
        }
      }

      try {
        console.log(`[LoopBack] ⑥ Recomputing deal state…`);
        const allMsgs = await getMessagesForDeal(existingDeal.id);
        const stateInput = allMsgs.map((m) => ({
          direction: m.direction,
          intent: m.intent,
          promised_date: m.promised_date,
          date: m.message_date,
          deal_value: m.deal_value,
          summary: m.summary,
        }));

        const newState = computeState(stateInput);
        console.log(`[LoopBack]    → direction: ${newState.direction}, timing: ${newState.timing}, terminal: ${newState.terminal}, staleness: ${newState.staleness_days}d`);

        await updateDealState(existingDeal.id, {
          currentState: newState.state,
          direction: newState.direction,
          timing: newState.timing,
          terminal: newState.terminal,
          stalenessDays: newState.staleness_days,
          promisedDate: newState.promised_date,
          dealValue: newState.deal_value,
          lastActivityAt: newState.last_activity,
          lastActionSummary: newState.last_action_summary,
          needsResponse: newState.direction === 'you_owe',
          urgent: newState.urgent || false,
        });
        console.log(`[LoopBack]    → Deal state updated ✓`);
      } catch (err) {
        console.error(`[LoopBack] Error updating deal state for ${threadId}:`, err);
      }
    }

    await chrome.storage.local.set({ last_scan_timestamp: Date.now() });
    await setScanStatus('idle');
    console.log(
      `[LoopBack] Scan complete. Threads scanned: ${threadIds.length}. Groq LLM calls: ${messagesProcessed} (each new thread = 1 “is deal?” call; each new message in a deal = 1 more). If you only see 2 calls with 2 threads, both were likely classified as not-a-deal.`
    );

    notifyContentScript('state_updated');

    if (gmailTabVisible) {
      chrome.alarms.create('periodic_scan', { delayInMinutes: CONFIG.PERIODIC_SCAN_MINUTES });
    }
  } catch (err) {
    await setScanStatus('error', `Scan failed: ${err.message}`);
    console.error('[LoopBack] Scan pipeline error:', err);
  } finally {
    clearTimeout(scanTimeout);
    scanInProgress = false;
  }
}

async function notifyContentScript(type) {
  const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type }).catch((err) => {
      console.warn(`[LoopBack] Could not notify tab ${tab.id}:`, err.message);
    });
  }
}

// --- Event listeners ---

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[LoopBack] Extension installed');
  await seedDefaultBlacklist();
  runScanPipeline();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[LoopBack] Extension startup');
  runScanPipeline();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'periodic_scan') {
    if (gmailTabVisible) {
      runScanPipeline();
    } else {
      console.log('[LoopBack] Gmail not visible, skipping periodic scan');
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'scan_requested':
      runScanPipeline();
      sendResponse({ ok: true });
      break;

    case 'gmail_tab_active':
      gmailTabVisible = true;
      chrome.alarms.create('periodic_scan', { delayInMinutes: CONFIG.PERIODIC_SCAN_MINUTES });
      sendResponse({ ok: true });
      break;

    case 'gmail_tab_inactive':
      gmailTabVisible = false;
      chrome.alarms.clear('periodic_scan');
      sendResponse({ ok: true });
      break;

    case 'get_deals':
      (async () => {
        try {
          const ok = await ensureSupabase();
          if (!ok) {
            sendResponse({ deals: [], counts: {} });
            return;
          }
          const deals = await getAllDeals();
          const counts = await getDealCounts();
          sendResponse({ deals, counts });
        } catch (err) {
          console.error('[LoopBack] get_deals failed:', err);
          sendResponse({ deals: [], counts: {}, error: String(err?.message || err) });
        }
      })();
      return true;

    case 'get_messages':
      (async () => {
        try {
          const ok = await ensureSupabase();
          if (!ok) {
            sendResponse({ messages: [] });
            return;
          }
          const messages = await getMessagesForDeal(message.dealId);
          sendResponse({ messages });
        } catch (err) {
          console.error('[LoopBack] get_messages failed:', err);
          sendResponse({ messages: [], error: String(err?.message || err) });
        }
      })();
      return true;

    default:
      break;
  }
});

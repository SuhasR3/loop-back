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
  GEMINI_API_KEY: '',
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  SCAN_DEBOUNCE_SECONDS: 60,
  PERIODIC_SCAN_MINUTES: 5,
  STALE_THRESHOLD_DAYS: 7,
  MAX_MESSAGES_PER_SCAN: 20,
  MAX_THREAD_DEPTH: 20,
};

let gmailTabVisible = false;
let scanInProgress = false;

async function getConfig() {
  const stored = await chrome.storage.local.get(['gemini_api_key', 'supabase_url', 'supabase_anon_key']);
  return {
    GEMINI_API_KEY: stored.gemini_api_key || CONFIG.GEMINI_API_KEY,
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
  console.log('[LoopBack] Scan started');

  try {
    const cfg = await getConfig();
    if (!cfg.GEMINI_API_KEY) {
      console.warn('[LoopBack] Gemini API key not configured');
      return;
    }

    if (!(await ensureSupabase())) return;

    const token = await getAuthToken();
    const userEmail = await getUserEmail(token);

    const threadIds = await getRecentThreadIds(token, 30);
    console.log(`[LoopBack] Found ${threadIds.length} recent threads`);

    let messagesProcessed = 0;

    for (const threadId of threadIds) {
      if (messagesProcessed >= CONFIG.MAX_MESSAGES_PER_SCAN) {
        console.log('[LoopBack] Rate limit reached, queuing rest for next cycle');
        break;
      }

      if (await isSkippedThread(threadId)) continue;

      let threadData;
      try {
        threadData = await getThread(token, threadId);
      } catch (err) {
        if (err.message === 'AUTH_EXPIRED') {
          chrome.identity.removeCachedAuthToken({ token });
          console.error('[LoopBack] Auth expired, need re-auth');
          return;
        }
        console.error(`[LoopBack] Error fetching thread ${threadId}:`, err);
        continue;
      }

      if (!threadData.messages || threadData.messages.length === 0) continue;

      const sender = parseSender(threadData.messages[0]);
      if (await isBlacklisted(sender.email)) {
        console.log(`[LoopBack] Blacklisted sender: ${sender.email}`);
        await skipThread(threadId).catch(() => {});
        continue;
      }

      let existingDeal = await getExistingDeal(threadId);

      if (!existingDeal) {
        const messageBodies = threadData.messages.slice(0, 3).map((m) => m.bodyText);
        const classification = await classifyIsDeal(cfg.GEMINI_API_KEY, threadData.subject, messageBodies);
        messagesProcessed++;

        if (!classification.isDeal) {
          await skipThread(threadId).catch(() => {});
          continue;
        }

        existingDeal = await createDeal({
          threadId,
          subject: threadData.subject,
          contactName: classification.contactName,
          contactEmail: classification.contactEmail || sender.email,
          company: classification.company,
        });
      }

      const existingMsgIds = await getExistingMessages(existingDeal.id);
      let messages = threadData.messages;

      if (messages.length > 50) {
        messages = messages.slice(-CONFIG.MAX_THREAD_DEPTH);
      }

      const newMessages = messages.filter((m) => !existingMsgIds.includes(m.id));
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
        try {
          const classified = await classifyMessage(
            cfg.GEMINI_API_KEY,
            msg.bodyText,
            direction,
            threadData.subject,
            previousMsgs
          );

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

        await updateDealState(existingDeal.id, {
          currentState: newState.state,
          stalenessDays: newState.staleness_days,
          promisedDate: newState.promised_date,
          dealValue: newState.deal_value,
          lastActivityAt: newState.last_activity,
          lastActionSummary: newState.last_action_summary,
          needsResponse: newState.state === 'waiting_on_you',
        });
      } catch (err) {
        console.error(`[LoopBack] Error updating deal state for ${threadId}:`, err);
      }
    }

    await chrome.storage.local.set({ last_scan_timestamp: Date.now() });
    console.log(`[LoopBack] Scan complete. Processed ${messagesProcessed} messages.`);

    notifyContentScript('state_updated');

    if (gmailTabVisible) {
      chrome.alarms.create('periodic_scan', { delayInMinutes: CONFIG.PERIODIC_SCAN_MINUTES });
    }
  } catch (err) {
    console.error('[LoopBack] Scan pipeline error:', err);
  } finally {
    scanInProgress = false;
  }
}

function notifyContentScript(type) {
  chrome.tabs.query({ url: 'https://mail.google.com/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type }).catch(() => {});
    }
  });
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
      ensureSupabase().then((ok) => {
        if (!ok) return sendResponse({ deals: [], counts: {} });
        return getAllDeals().then((deals) =>
          getDealCounts().then((counts) => sendResponse({ deals, counts }))
        );
      });
      return true;

    case 'get_messages':
      ensureSupabase().then((ok) => {
        if (!ok) return sendResponse({ messages: [] });
        return getMessagesForDeal(message.dealId).then((messages) =>
          sendResponse({ messages })
        );
      });
      return true;

    default:
      break;
  }
});

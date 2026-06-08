# Loop Back

Tracks which Gmail threads are waiting on you, and which have gone stale, from inside Gmail.

![JavaScript](https://img.shields.io/badge/JavaScript-ES_Modules-f7df1e)
![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4)
![LLM](https://img.shields.io/badge/LLM-Groq_llama_3.3_70b-FF6B00)
![Database](https://img.shields.io/badge/Database-Supabase_Postgres-3ECF8E)

> 🏆 Winner · VillageHacks 2026 · Arizona State University

![Alt Text](https://github.com/SuhasR3/loop-back/blob/main/pipeline-tracker/demo.jpeg)

## What it is

Email threads that need follow up get buried. Loop Back scans your inbox, uses an LLM to decide which threads are worth tracking (deals, event coordination, action items), and renders a sidebar inside Gmail showing who owes the next reply and whether each thread is on schedule or stale. The LLM classifies individual messages and a deterministic state machine does everything else.

## Features

- **Automatic scanning, gated on visibility.** Triggered on install, browser startup, Gmail tab focus, a 5 minute alarm, and a manual button. Debounced to skip scans less than 60 seconds apart and guarded by a 180 second watchdog.
- **Two stage LLM classification.** First decides whether a thread is trackable (accepted only when confidence is at least 0.4), then classifies each new message into one of 8 intents with a short summary, an optional promised date, and an optional dollar value.
- **Dual dimension state tracking.** Every thread carries two independent labels: Direction (`you_owe` / `they_owe`) and Timing (`active` / `scheduled` / `stale`), plus terminal `won` / `dead` states. Computed by rules, not by the model.
- **Sender blacklist.** Runs before any LLM call, seeded with common automated senders, editable in the popup.
- **Urgency flagging.** A thread is marked urgent when it is waiting on you for more than 3 days.

## Architecture

Components:

- **Service worker** (`background/service-worker.js`): the scan loop, orchestration, debounce and timeout logic, alarm scheduling, and the message router that content scripts and the popup call into.
- **Gmail API client** (`background/gmail-api.js`): OAuth token retrieval, thread and message fetch, header and body parsing, sender and direction detection.
- **LLM classifier** (`background/llm-classifier.js`): Groq chat completions in JSON mode, rate limiting, retries, and defensive JSON parsing.
- **State machine** (`background/state-machine.js`): a pure `computeState(messages)` returning direction, timing, terminal state, and staleness.
- **Supabase client** (`background/supabase-client.js`): a hand rolled PostgREST client (no SDK) for the three tables.
- **Content scripts and popup**: sidebar injection and rendering, a `chrome.runtime` bridge that survives extension reloads, and the settings and blacklist UI.

Data flow (one scan):

```
                         (focus / alarm / install / "Scan Now")
                                        |
                                        v
   inject-sidebar.js / popup.js  --chrome.runtime.sendMessage-->  service-worker.js
                                                                        |
                                          getConfig() from chrome.storage.local
                                                                        |
                          getAuthToken() (chrome.identity) + getUserEmail()
                                                                        |
                  getRecentThreadIds(token, 30d, max 100) --> slice to 20  (Gmail API)
                                                                        |
                                              for each threadId:
                                                                        |
                       isSkippedThread? / isBlacklisted(sender)?  --> skip
                                                                        |
                              getThread(token, id)  (Gmail API, format=full)
                                                                        |
                 new thread? --> classifyIsDeal()  (Groq)  --> not deal --> skipThread()
                                                                        |
                                       createDeal()  (Supabase POST)
                                                                        |
              for each new message: classifyMessage() (Groq) --> addMessage() (Supabase)
                                                                        |
                  getMessagesForDeal() --> computeState() --> updateDealState() (Supabase)
                                                                        |
                       notifyContentScript('state_updated') --> sidebar.refreshSidebar()
```

Sync and async boundaries:

- Processing is sequential. Threads one at a time, messages within a thread one at a time. No parallelism or batching of LLM calls.
- Throughput is throttled on purpose with a 1.5 second minimum gap between Groq calls.
- Per scan budgets cap work at 20 threads and 50 Groq calls. Remaining work defers to the next cycle.
- UI updates are push based via `chrome.tabs.sendMessage`, with a 3 second poll used only for the scan status text.

## Engineering decisions

**Deterministic state, not LLM state.** The model classifies individual message intent. A pure `computeState` function derives Direction and Timing from the message sequence using fixed rules: latest message direction, defer with a promised date, 14 day staleness, terminal reject or commit. State transitions stay auditable instead of depending on model output.

**Cost discipline tuned to a real ceiling.** The blacklist runs before any LLM call, and confirmed non deals are written to `skipped_threads` so they never cost a token twice. The classifier enforces a 1.5 second inter call gap, per scan caps of 20 threads and 50 calls, and a 180 second watchdog, all tuned to Groq's free tier limits (12k tokens per minute, 100k per day).

**One composite state column, two dimensions reconstructed on read.** The database CHECK constraint allows only 6 legacy enum values, so the two dimension model maps down to a database safe value on write and `parseDealState` rebuilds Direction and Timing on read. This keeps the schema backward compatible at the cost of being lossy for some combinations.

**Hand rolled PostgREST client, no SDK.** Loop Back talks to Supabase directly over REST with the anon key, which keeps the MV3 service worker free of runtime dependencies and needs no bundler or build step.

**Surviving the MV3 "Extension context invalidated" failure.** Reloading the extension while Gmail stays open kills `chrome.runtime` in still running content scripts. A bridge detects the dead runtime and shows a "refresh this tab" hint instead of throwing.

**Visibility gated work.** The 5 minute alarm only runs while a Gmail tab is visible, so there is no background API usage when you are away from Gmail.

## Tech stack

- **Language**: vanilla JavaScript, ES modules. No framework, no bundler, no build step.
- **Platform**: Chrome Manifest V3. Module service worker, content scripts at `document_idle`.
- **LLM**: Groq, OpenAI compatible chat completions, model `llama-3.3-70b-versatile`.
- **Database**: Supabase (Postgres + PostgREST), accessed over REST with the anon key.
- **Auth**: Google OAuth2 via `chrome.identity`, scope `gmail.readonly`.

## Setup and run

1. Clone the repo. At `chrome://extensions`, enable Developer mode and Load unpacked, pointed at the project directory.
2. Create a Supabase project and run the schema SQL to create the three tables.
3. Replace the placeholder OAuth `client_id` in `manifest.json` with your own Google Cloud OAuth client (Gmail read only scope).
4. Open the extension popup. Enter your Groq API key, Supabase URL, and Supabase anon key.
5. Click Connect Gmail and complete the Google OAuth consent.
6. Open Gmail. The sidebar injects and the first scan runs.

## Scope and limitations

- **Permissive security.** Supabase RLS policies are set to allow all, so the anon key has unrestricted read and write to every table, with no per user scoping. API keys sit unencrypted in `chrome.storage.local`. Acceptable for local single user use; real deployment would need per user RLS and a credential proxy.
- **Single deal pool.** The data model has no user column, so two Gmail accounts pointed at the same Supabase project share one set of deals.
- **Lossy state reconstruction.** Because state is stored as one legacy enum and re expanded on read, some Direction plus Timing combinations cannot be perfectly recovered.
- **Coarse error handling.** Failures log to the service worker console and surface as a status string. There is no retry queue, and a failed message classification is skipped silently.
- **Local LLM for privacy.** Email content currently goes to Groq's API. A local model (for example via Ollama) would keep inbox content on device and remove the third party dependency for classification.

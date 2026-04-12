# Loop Back — Gmail Pipeline Tracker

A Chrome Extension (Manifest V3) that scans your Gmail inbox and automatically classifies email threads into a trackable pipeline with two independent dimensions: **Direction** (who owes the next action) and **Timing** (is the thread on schedule, stale, or scheduled).

## How It Works

1. **Gmail Scan** — On load and every 5 minutes, the extension fetches your 20 most recent inbox threads via the Gmail API.
2. **LLM Classification** — Each thread is sent to Groq (LLaMA 3.3 70B) to determine if it's trackable (deals, event coordination, action items, etc.).
3. **State Machine** — Classified threads are assigned two independent dimensions:
   - **Direction**: `You Owe` (ball is in your court) or `They Owe` (waiting on them)
   - **Timing**: `Active`, `Scheduled` (future promised date), or `Stale` (14+ days inactive or past promised date)
4. **Sidebar** — A sidebar injected into Gmail shows all tracked threads with filter pills, colored intent blips on the timeline, and urgency badges.
5. **Supabase Storage** — All deal state and message history is persisted in a Supabase Postgres database.

## Architecture

```
pipeline-tracker/
├── manifest.json              # MV3 config, OAuth2, permissions
├── background/
│   ├── service-worker.js      # Main scan loop, orchestration
│   ├── gmail-api.js           # Gmail API calls (threads, messages, auth)
│   ├── llm-classifier.js      # Groq LLM classification (is-deal + message intent)
│   ├── state-machine.js       # Dual-dimension state computation
│   ├── supabase-client.js     # Supabase REST API client + state parser
│   └── blacklist-filter.js    # Sender blacklist (skip automated emails)
├── content/
│   ├── loop-back-chrome.js    # Content script bridge
│   ├── inject-sidebar.js      # Sidebar DOM injection into Gmail
│   └── sidebar/
│       ├── index.html         # Sidebar markup
│       ├── sidebar.js         # Sidebar rendering, filters, timeline
│       └── sidebar.css        # Styles, badges, blips, animations
├── popup/
│   ├── popup.html             # Extension popup (settings, API keys)
│   ├── popup.js               # Popup logic
│   └── popup.css              # Popup styles
├── icons/                     # Extension icons (16, 48, 128px)
└── seed-demo-data.js          # Demo data seeder (dev only)
```

## State Machine

The state machine computes two independent dimensions per deal:

| Dimension | Values | Logic |
|-----------|--------|-------|
| **Direction** | `you_owe`, `they_owe` | Based on who sent the last message (inbound = you_owe, outbound = they_owe) |
| **Timing** | `active`, `scheduled`, `stale` | Based on promised dates and days since last activity |
| **Terminal** | `dead`, `won` | Latest inbound message was a reject or commit |

The UI shows both dimensions as separate pill badges on each deal card.

## Intent Blips

Each message in the timeline gets a colored dot indicating its intent:

- **Green** — commit / agree
- **Red** — reject
- **Orange** — defer
- **Yellow** — ask / follow_up
- **Blue** — intro / info

## Setup

### Prerequisites

- Google Chrome
- A Google Cloud project with the Gmail API enabled
- A Groq API key ([console.groq.com/keys](https://console.groq.com/keys))
- A Supabase project with the required tables

### 1. Google Cloud OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Enable the **Gmail API**.
3. Go to **Google Auth Platform > Clients** and create a new OAuth client:
   - Application type: **Chrome Extension**
   - Item ID: your extension ID (found at `chrome://extensions/` after loading unpacked)
4. Copy the Client ID and paste it into `manifest.json` under `oauth2.client_id`.
5. Under **Audience**, set the user type to **Internal** (for Google Workspace) or add test users.

### 2. Supabase

Create a Supabase project and run the following SQL to create the required tables:

```sql
CREATE TABLE deals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  company TEXT,
  deal_value NUMERIC,
  current_state TEXT DEFAULT 'waiting_on_them',
  staleness_days INTEGER DEFAULT 0,
  promised_date DATE,
  last_activity_at TIMESTAMPTZ,
  last_action_summary TEXT,
  needs_response BOOLEAN DEFAULT FALSE,
  direction TEXT,
  timing TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  intent TEXT,
  summary TEXT,
  promised_date DATE,
  deal_value NUMERIC,
  message_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE skipped_threads (
  thread_id TEXT PRIMARY KEY,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. Load the Extension

1. Open `chrome://extensions/` and enable **Developer mode**.
2. Click **Load unpacked** and select the `pipeline-tracker/` folder.
3. Click the extension icon and enter your Groq API key, Supabase URL, and Supabase anon key in the popup settings.
4. Open Gmail — the sidebar should appear and begin scanning.

## Configuration

All credentials are entered via the extension popup (no hardcoded keys):

| Setting | Where to get it |
|---------|----------------|
| Groq API Key | [console.groq.com/keys](https://console.groq.com/keys) |
| Supabase URL | Your Supabase project dashboard |
| Supabase Anon Key | Supabase project settings > API |
| OAuth Client ID | Google Cloud Console > Auth Platform > Clients |

## Rate Limits

The extension includes built-in rate limiting (1.5s between Groq API calls) to stay within Groq's free tier limits (12k TPM, 100k TPD). The scan timeout is set to 180 seconds to accommodate throttled processing.

## License

MIT

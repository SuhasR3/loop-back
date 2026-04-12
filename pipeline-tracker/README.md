# Loop Back — Gmail Thread-State Tracker for Sales Pipelines

A Chrome Extension (Manifest V3) that reads Gmail threads, classifies each message's intent using **Groq** (JSON mode), builds a per-thread state machine, and renders a sidebar panel inside Gmail showing all deals sorted by staleness.

## Setup

### 1. Google OAuth

1. Create a project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable the Gmail API
3. Create OAuth 2.0 credentials (Chrome Extension type)
4. Copy the client ID into `manifest.json` → `oauth2.client_id`

### 2. Groq API

1. Create an API key at [console.groq.com/keys](https://console.groq.com/keys)
2. Enter the key in the extension popup settings (or `GROQ_API_KEY` in `service-worker.js` `CONFIG`)

### 3. Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run the schema SQL (see below) in the SQL Editor
3. Enter the project URL and anon key in the extension popup settings

### 4. Database Schema

Run this in your Supabase SQL Editor:

```sql
CREATE TABLE deals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id TEXT UNIQUE NOT NULL,
  subject TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  company TEXT,
  deal_value NUMERIC,
  current_state TEXT NOT NULL DEFAULT 'waiting_on_them',
  staleness_days INTEGER DEFAULT 0,
  promised_date DATE,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_action_summary TEXT,
  needs_response BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT valid_state CHECK (current_state IN (
    'waiting_on_you', 'waiting_on_them', 'scheduled', 'stale', 'dead', 'won'
  ))
);

CREATE TABLE messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  gmail_message_id TEXT UNIQUE NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  intent TEXT NOT NULL CHECK (intent IN (
    'intro', 'ask', 'commit', 'defer', 'reject', 'agree', 'follow_up', 'info'
  )),
  summary TEXT,
  promised_date DATE,
  deal_value NUMERIC,
  message_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE skipped_threads (
  thread_id TEXT PRIMARY KEY,
  checked_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_deals_thread_id ON deals(thread_id);
CREATE INDEX idx_deals_current_state ON deals(current_state);
CREATE INDEX idx_messages_deal_id ON messages(deal_id);
CREATE INDEX idx_messages_gmail_id ON messages(gmail_message_id);

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE skipped_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on deals" ON deals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on messages" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on skipped_threads" ON skipped_threads FOR ALL USING (true) WITH CHECK (true);
```

### 5. Install Extension

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `pipeline-tracker/` directory

### 6. Seed Demo Data (Optional)

```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_ANON_KEY=your-key \
node seed-demo-data.js
```

## Project Structure

```
pipeline-tracker/
├── manifest.json              # Chrome Extension manifest (MV3)
├── background/
│   ├── service-worker.js      # Main orchestrator
│   ├── gmail-api.js           # Gmail API wrapper
│   ├── blacklist-filter.js    # Sender blacklist
│   ├── llm-classifier.js     # Groq (OpenAI-compatible JSON mode)
│   ├── state-machine.js      # Thread state computation
│   └── supabase-client.js    # Supabase REST client
├── content/
│   ├── inject-sidebar.js     # Gmail DOM injection
│   └── sidebar/
│       ├── index.html
│       ├── sidebar.js        # Sidebar rendering (vanilla JS)
│       └── sidebar.css       # Design system
├── popup/
│   ├── popup.html            # Settings + blacklist management
│   ├── popup.js
│   └── popup.css
├── icons/
├── seed-demo-data.js         # Demo data seeder
└── .env.example
```

## Architecture

- **Trigger-based scanning**: Scans on Gmail tab focus, periodic 5-min alarm while visible, manual button, or extension install
- **Debounced**: Skips scan if last one was <60s ago
- **Blacklist-first**: Sender check runs before any LLM call
- **LLM classification**: Groq (`llama-3.3-70b-versatile`) with `response_format: json_object`
- **State machine**: Deterministic state computation from message sequence
- **Supabase storage**: Deals and messages persisted via PostgREST API

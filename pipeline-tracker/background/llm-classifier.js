/**
 * LLM classification via Groq (OpenAI-compatible API).
 * JSON output: response_format.type = json_object (requires "json" in messages per API rules).
 */

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const JSON_SYSTEM =
  'You are a precise assistant. Every reply must be a single JSON object only — no markdown fences, no commentary.';

// Rate limiter for Groq API (12000 TPM limit)
let lastGroqCallTime = 0;
async function rateLimitWait() {
  const now = Date.now();
  const elapsed = now - lastGroqCallTime;
  if (elapsed < 1500) {
    await sleep(1500 - elapsed);
  }
  lastGroqCallTime = Date.now();
}

async function callGroq(apiKey, userPrompt, retries = 3) {
  // Apply rate limiting before attempting the call
  await rateLimitWait();
  const url = `${GROQ_CHAT_URL}`;

  const body = {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: JSON_SYSTEM },
      {
        role: 'user',
        content: `${userPrompt}\n\nYour entire response must be one valid JSON object (json mode).`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  };

  let lastErr = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (resp.status === 429) {
        const t = await resp.text();
        const wait = Math.min(20, 2 ** (attempt + 2));
        console.warn(`[LoopBack] Groq 429, waiting ${wait}s…`, t.slice(0, 120));
        await sleep(wait * 1000);
        lastErr = new Error(`Groq 429: ${t}`);
        continue;
      }

      if (!resp.ok) {
        const errText = await resp.text();
        lastErr = new Error(`Groq API ${resp.status}: ${errText}`);
        if (resp.status >= 500 && attempt < retries - 1) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw lastErr;
      }

      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content || '';
      console.log(`[LoopBack] Groq ${GROQ_MODEL} OK`);
      return parseJsonResponse(text);
    } catch (err) {
      lastErr = err;
      if (err.name === 'AbortError') {
        throw new Error('Groq request timed out after 60s');
      }
      if (attempt < retries - 1) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }

  throw lastErr || new Error('Groq call failed');
}

function parseJsonResponse(text) {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Failed to parse LLM JSON response');
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function classifyIsDeal(apiKey, subject, firstFewMessages) {
  const msgText = firstFewMessages
    .slice(0, 3)
    .map((m) => m.substring(0, 500))
    .join('\n---\n');

  const prompt = `You are classifying email threads. Determine if this thread is TRACKABLE — meaning it involves a real human interaction that could require follow-up, action, or response.

TRACKABLE threads include (mark is_deal: true):
- Any business deal, sales, pricing, proposal, partnership, or contract discussion
- Event coordination, hackathon logistics, team assignments, scheduling
- Meeting invitations, calendar events requiring response
- Project collaboration, task assignments, work requests
- Direct messages from real people asking questions or sharing updates
- Any thread where someone is expecting a reply or action from you
- Discussions about deadlines, submissions, assignments, grading
- Payment, invoice, or financial discussions

NOT trackable (mark is_deal: false):
- Automated newsletters or bulk marketing (e.g. "84 New Jobs Posted Today")
- System notifications with no human sender (Sentry alerts, CI/CD, automated reports)
- Login/security verification emails (OTP, "Secure link to log in")
- Automated survey reminders with no personal context
- Purely automated time-tracking or payroll system emails
- Notification-only emails from tools like Jira, Notion (no direct human message)

Thread subject: "${subject}"

Recent messages (most recent first):
---
${msgText}
---

Respond with ONLY this JSON object shape:
{
  "is_deal": true or false,
  "confidence": number from 0.0 to 1.0,
  "company": string or null (organization or group name),
  "contact_name": string or null (primary person's name),
  "contact_email": string or null
}`;

  const result = await callGroq(apiKey, prompt);
  return {
    isDeal: result.is_deal === true && (result.confidence || 0) >= 0.4,
    company: result.company || null,
    contactName: result.contact_name || null,
    contactEmail: result.contact_email || null,
  };
}

export async function classifyMessage(apiKey, messageBody, direction, threadSubject, previousMessages) {
  const prevText = previousMessages
    .slice(-5)
    .map((m) => `[${m.date}] [${m.direction}] ${m.sender}: ${m.snippet.substring(0, 300)}`)
    .join('\n');

  const currentDate = new Date().toISOString().split('T')[0];

  const prompt = `You are analyzing a single email message within a tracked thread (could be a deal, event, project, or any actionable conversation).

Thread subject: "${threadSubject}"
Message direction: ${direction} (inbound = someone wrote to us, outbound = we wrote to them)

Previous messages in this thread (oldest first, for context):
---
${prevText}
---

New message to classify:
---
${messageBody.substring(0, 1000)}
---

Classify this message. Respond with ONLY this JSON object shape:
{
  "intent": one of "intro", "ask", "commit", "defer", "reject", "agree", "follow_up", "info",
  "summary": string max 80 chars,
  "promised_date": ISO date string or null,
  "deal_value": number or null,
  "needs_response": boolean
}

Intent definitions:
- intro: First outreach, introduction, or announcement message
- ask: Requesting information, action, RSVP, details, or a meeting
- commit: Agreeing to next steps, confirming participation, signing up
- defer: Explicitly delaying or postponing ("let's discuss next week")
- reject: Declining, not interested, canceling
- agree: Positive acknowledgment, accepting terms, confirming receipt
- follow_up: Checking in, nudging, reminder
- info: Sharing information, updates, or status without requesting action

For promised_date use ISO date; today's date is ${currentDate}. If vague or none, null.

For deal_value extract monetary amounts in dollars if mentioned; "$48k" -> 48000. If no money discussed, null.`;

  return callGroq(apiKey, prompt);
}

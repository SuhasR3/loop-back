/**
 * LLM classification via Groq (OpenAI-compatible API).
 * JSON output: response_format.type = json_object (requires "json" in messages per API rules).
 */

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const JSON_SYSTEM =
  'You are a precise assistant. Every reply must be a single JSON object only — no markdown fences, no commentary.';

async function callGroq(apiKey, userPrompt, retries = 3) {
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

  const prompt = `You are classifying email threads. Determine if this is a B2B sales/business deal thread.

A deal thread involves: sales outreach, pricing discussions, proposals, negotiations, partnership discussions, contract discussions, or business development conversations.

NOT a deal: newsletters, automated notifications, internal team chat, personal emails, support tickets, marketing blasts.

Thread subject: "${subject}"

Recent messages (most recent first):
---
${msgText}
---

Respond with ONLY this JSON object shape:
{
  "is_deal": true or false,
  "confidence": number from 0.0 to 1.0,
  "company": string or null,
  "contact_name": string or null,
  "contact_email": string or null
}`;

  const result = await callGroq(apiKey, prompt);
  return {
    isDeal: result.is_deal === true && (result.confidence || 0) >= 0.6,
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

  const prompt = `You are analyzing a single email message within a B2B sales thread.

Thread subject: "${threadSubject}"
Message direction: ${direction} (inbound = prospect wrote to us, outbound = we wrote to prospect)

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
- intro: First outreach or introduction message
- ask: Requesting information, pricing, details, a meeting
- commit: Agreeing to next steps, signing, purchasing
- defer: Explicitly delaying
- reject: Declining, not interested, going with competitor
- agree: Positive acknowledgment, accepting terms, confirming
- follow_up: Checking in, nudging
- info: Sharing information without requesting action

For promised_date use ISO date; today's date is ${currentDate}. If vague, null.

For deal_value extract DEAL size in dollars; "$48k" -> 48000. Monthly pricing alone -> null unless total is clear.`;

  return callGroq(apiKey, prompt);
}

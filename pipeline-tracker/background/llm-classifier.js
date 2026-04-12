const GEMINI_MODEL = 'gemini-2.0-flash';

async function callGemini(apiKey, prompt, retries = 3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1 },
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Gemini API ${resp.status}: ${errText}`);
      }

      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return parseJsonResponse(text);
    } catch (err) {
      if (attempt < retries - 1) {
        await sleep(Math.pow(2, attempt) * 1000);
        continue;
      }
      throw err;
    }
  }
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

Respond with ONLY this JSON, no other text:
{
  "is_deal": true/false,
  "confidence": 0.0-1.0,
  "company": "extracted company name or null",
  "contact_name": "primary contact name or null",
  "contact_email": "primary contact email or null"
}`;

  const result = await callGemini(apiKey, prompt);
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

Classify this message and extract structured data. Respond with ONLY this JSON:
{
  "intent": one of ["intro", "ask", "commit", "defer", "reject", "agree", "follow_up", "info"],
  "summary": "one-line summary, max 80 chars",
  "promised_date": "ISO date string if a specific date/day is mentioned, null otherwise",
  "deal_value": number if a dollar amount is mentioned for the deal, null otherwise,
  "needs_response": true/false
}

Intent definitions:
- "intro": First outreach or introduction message
- "ask": Requesting information, pricing, details, a meeting
- "commit": Agreeing to next steps, signing, purchasing
- "defer": Explicitly delaying ("let me check with my team", "circle back next week")
- "reject": Declining, not interested, going with competitor
- "agree": Positive acknowledgment, accepting terms, confirming
- "follow_up": Checking in, nudging, "just following up"
- "info": Sharing information without requesting action (sending docs, FYI)

For promised_date:
- "Friday" when today is Wednesday Apr 9 → "2026-04-11"
- "next week" → the following Monday
- "end of month" → last day of current month
- Today's date is ${currentDate}
- If vague ("soon", "sometime"), set to null

For deal_value:
- Extract the DEAL size, not arbitrary numbers
- "$48k" → 48000
- "$1.2M" → 1200000
- "200/month" → null (this is pricing, not deal value — unless context makes total clear)`;

  return callGemini(apiKey, prompt);
}

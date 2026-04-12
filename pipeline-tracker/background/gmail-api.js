const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';

export async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

export async function getRecentThreadIds(token, daysBack = 30) {
  const url = `${GMAIL_API_BASE}/threads?q=in:inbox+newer_than:${daysBack}d&maxResults=100`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (resp.status === 401) {
    throw new Error('AUTH_EXPIRED');
  }

  const data = await resp.json();
  if (!data.threads) return [];
  return data.threads.map((t) => t.id);
}

export async function getThread(token, threadId) {
  const url = `${GMAIL_API_BASE}/threads/${threadId}?format=full`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (resp.status === 401) {
    throw new Error('AUTH_EXPIRED');
  }

  const data = await resp.json();
  const subject = extractHeader(data.messages?.[0], 'Subject') || '(no subject)';

  const messages = (data.messages || []).map((msg) => ({
    id: msg.id,
    from: extractHeader(msg, 'From') || '',
    to: extractHeader(msg, 'To') || '',
    date: extractHeader(msg, 'Date') || '',
    snippet: msg.snippet || '',
    bodyText: extractBodyText(msg.payload),
  }));

  return { id: data.id, subject, messages };
}

export function parseSender(message) {
  const from = typeof message === 'string' ? message : message.from || '';
  const match = from.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+@[^>]+)>?$/);
  if (match) {
    return { name: (match[1] || '').trim(), email: match[2].trim().toLowerCase() };
  }
  return { name: '', email: from.trim().toLowerCase() };
}

export function getDirection(message, userEmail) {
  const sender = parseSender(message);
  return sender.email === userEmail.toLowerCase() ? 'outbound' : 'inbound';
}

export async function getUserEmail(token) {
  const cached = await chrome.storage.local.get('user_email');
  if (cached.user_email) return cached.user_email;

  const resp = await fetch(`${GMAIL_API_BASE}/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await resp.json();
  const email = data.emailAddress;
  await chrome.storage.local.set({ user_email: email });
  return email;
}

function extractHeader(message, headerName) {
  if (!message?.payload?.headers) return null;
  const header = message.payload.headers.find(
    (h) => h.name.toLowerCase() === headerName.toLowerCase()
  );
  return header?.value || null;
}

function extractBodyText(payload) {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    const plain = findPartByMime(payload.parts, 'text/plain');
    if (plain) return decodeBase64Url(plain.body.data);

    const html = findPartByMime(payload.parts, 'text/html');
    if (html) return stripHtml(decodeBase64Url(html.body.data));
  }

  if (payload.body?.data) {
    return stripHtml(decodeBase64Url(payload.body.data));
  }

  return '';
}

function findPartByMime(parts, mimeType) {
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) return part;
    if (part.parts) {
      const found = findPartByMime(part.parts, mimeType);
      if (found) return found;
    }
  }
  return null;
}

function decodeBase64Url(encoded) {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    return decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch {
    return '';
  }
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

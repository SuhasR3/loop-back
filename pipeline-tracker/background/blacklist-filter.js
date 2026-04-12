const DEFAULT_BLACKLIST = [
  '@noreply.github.com',
  '@notifications.google.com',
  '@noreply.google.com',
  'noreply@medium.com',
  '@linkedin.com',
  '@facebookmail.com',
  '@amazonses.com',
  'no-reply@accounts.google.com',
  '@mail.notion.so',
  '@slack.com',
  '@atlassian.net',
  '@jira.atlassian.com',
];

export async function isBlacklisted(senderEmail) {
  const list = await getBlacklist();
  const email = senderEmail.toLowerCase();
  const domain = email.split('@')[1];

  if (list.includes(email)) return true;

  if (domain) {
    const parts = domain.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const sub = '@' + parts.slice(i).join('.');
      if (list.includes(sub)) return true;
    }
  }

  return false;
}

export async function addToBlacklist(entry) {
  const normalized = entry.toLowerCase().trim();
  const list = await getBlacklist();
  if (!list.includes(normalized)) {
    list.push(normalized);
    await chrome.storage.local.set({ sender_blacklist: list });
  }
}

export async function removeFromBlacklist(entry) {
  const normalized = entry.toLowerCase().trim();
  const list = await getBlacklist();
  const filtered = list.filter((e) => e !== normalized);
  await chrome.storage.local.set({ sender_blacklist: filtered });
}

export async function getBlacklist() {
  const data = await chrome.storage.local.get('sender_blacklist');
  return data.sender_blacklist || [];
}

export async function seedDefaultBlacklist() {
  const existing = await getBlacklist();
  if (existing.length === 0) {
    await chrome.storage.local.set({ sender_blacklist: [...DEFAULT_BLACKLIST] });
  }
}

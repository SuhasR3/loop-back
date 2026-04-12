document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await loadBlacklist();
  setupEventListeners();
});

async function loadConfig() {
  const data = await chrome.storage.local.get([
    'gemini_api_key',
    'supabase_url',
    'supabase_anon_key',
    'user_email',
  ]);

  if (data.gemini_api_key) {
    document.getElementById('gemini-key').value = data.gemini_api_key;
  }
  if (data.supabase_url) {
    document.getElementById('supabase-url').value = data.supabase_url;
  }
  if (data.supabase_anon_key) {
    document.getElementById('supabase-key').value = data.supabase_anon_key;
  }
  if (data.user_email) {
    document.getElementById('gmail-email').textContent = data.user_email;
    document.querySelector('.popup-status-dot').classList.remove('popup-status-dot--disconnected');
    document.querySelector('.popup-status-dot').classList.add('popup-status-dot--connected');
    document.getElementById('gmail-connect').textContent = 'Reconnect';
  }

  updateStats();
}

async function saveConfig() {
  const geminiKey = document.getElementById('gemini-key').value.trim();
  const supabaseUrl = document.getElementById('supabase-url').value.trim();
  const supabaseKey = document.getElementById('supabase-key').value.trim();

  await chrome.storage.local.set({
    gemini_api_key: geminiKey,
    supabase_url: supabaseUrl,
    supabase_anon_key: supabaseKey,
  });

  const btn = document.getElementById('save-config');
  btn.textContent = '✓ Saved!';
  setTimeout(() => {
    btn.textContent = 'Save Configuration';
  }, 2000);
}

async function connectGmail() {
  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(token);
      });
    });

    const resp = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const profile = await resp.json();
    const email = profile.emailAddress;

    await chrome.storage.local.set({ user_email: email });

    document.getElementById('gmail-email').textContent = email;
    document.querySelector('.popup-status-dot').classList.remove('popup-status-dot--disconnected');
    document.querySelector('.popup-status-dot').classList.add('popup-status-dot--connected');
    document.getElementById('gmail-connect').textContent = 'Reconnect';
  } catch (err) {
    console.error('Gmail connect error:', err);
    document.getElementById('gmail-email').textContent = 'Connection failed';
  }
}

async function scanNow() {
  const btn = document.getElementById('scan-now');
  btn.textContent = '⟳ Scanning...';
  btn.disabled = true;

  chrome.runtime.sendMessage({ type: 'scan_requested' });

  setTimeout(() => {
    btn.textContent = '⟳ Scan Now';
    btn.disabled = false;
    updateStats();
  }, 3000);
}

async function updateStats() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get_deals' });
    if (!response) return;

    const deals = response.deals || [];
    const counts = response.counts || {};
    const statsEl = document.getElementById('stats');

    const blacklist = await chrome.storage.local.get('sender_blacklist');
    const blCount = (blacklist.sender_blacklist || []).length;

    statsEl.innerHTML = `
      Tracking <strong>${deals.length}</strong> deals · <strong>${blCount}</strong> senders blacklisted
    `;
  } catch {
    // Background not ready yet
  }
}

// --- Blacklist Management ---

async function loadBlacklist() {
  const data = await chrome.storage.local.get('sender_blacklist');
  const list = data.sender_blacklist || [];
  renderBlacklist(list);
}

function renderBlacklist(list) {
  const countEl = document.getElementById('blacklist-count');
  countEl.textContent = `${list.length} senders / domains blacklisted`;

  const listEl = document.getElementById('blacklist-list');
  if (list.length === 0) {
    listEl.innerHTML = '<div class="popup-blacklist-empty">No entries yet</div>';
    return;
  }

  listEl.innerHTML = list
    .sort()
    .map(
      (entry) => `
      <div class="popup-blacklist-entry">
        <span class="popup-blacklist-entry-text">
          ${escapeHtml(entry)}
          ${entry.startsWith('@') ? '<span class="popup-blacklist-domain-hint">(all emails from this domain)</span>' : ''}
        </span>
        <button class="popup-blacklist-remove" data-entry="${escapeHtml(entry)}">✕</button>
      </div>`
    )
    .join('');

  listEl.querySelectorAll('.popup-blacklist-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entry = btn.dataset.entry;
      const data = await chrome.storage.local.get('sender_blacklist');
      const updated = (data.sender_blacklist || []).filter((e) => e !== entry);
      await chrome.storage.local.set({ sender_blacklist: updated });
      renderBlacklist(updated);
      updateStats();
    });
  });
}

async function addBlacklistEntry() {
  const input = document.getElementById('blacklist-input');
  const value = input.value.trim().toLowerCase();

  if (!value) return;

  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const isDomain = /^@[^\s@]+\.[^\s@]+$/.test(value);

  if (!isEmail && !isDomain) {
    input.style.borderColor = '#E24B4A';
    setTimeout(() => {
      input.style.borderColor = '';
    }, 2000);
    return;
  }

  const data = await chrome.storage.local.get('sender_blacklist');
  const list = data.sender_blacklist || [];

  if (!list.includes(value)) {
    list.push(value);
    await chrome.storage.local.set({ sender_blacklist: list });
  }

  input.value = '';
  renderBlacklist(list);
  updateStats();
}

function setupEventListeners() {
  document.getElementById('save-config').addEventListener('click', saveConfig);
  document.getElementById('gmail-connect').addEventListener('click', connectGmail);
  document.getElementById('scan-now').addEventListener('click', scanNow);
  document.getElementById('blacklist-add-btn').addEventListener('click', addBlacklistEntry);

  document.getElementById('blacklist-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBlacklistEntry();
  });

  document.querySelectorAll('.popup-section-header').forEach((header) => {
    header.addEventListener('click', () => {
      const section = header.dataset.section;
      const body = document.getElementById(`${section}-section`);
      const toggle = header.querySelector('.popup-toggle');
      body.classList.toggle('popup-section-body--collapsed');
      toggle.textContent = body.classList.contains('popup-section-body--collapsed') ? '▸' : '▾';
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

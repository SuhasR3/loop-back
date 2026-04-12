function getSidebarHTML() {
  return `
    <div class="pt-header">
      <div class="pt-header-left">
        <span class="pt-icon">◷</span>
        <span class="pt-title">Loop Back</span>
      </div>
      <span class="pt-scan-status">Scans every 5 min</span>
    </div>
    <div class="pt-badges" id="pt-badges"></div>
    <div class="pt-value-at-risk" id="pt-value-at-risk"></div>
    <div class="pt-filters" id="pt-filters"></div>
    <div class="pt-deals" id="pt-deals">
      <div class="pt-loading">Loading deals...</div>
    </div>
    <div class="pt-timeline" id="pt-timeline" style="display:none"></div>
  `;
}

function injectSidebar() {
  const gmailContainer =
    document.querySelector('.bkK') ||
    document.querySelector('[role="main"]')?.parentElement;

  if (!gmailContainer || document.getElementById('pipeline-tracker-sidebar')) return;

  const sidebar = document.createElement('div');
  sidebar.id = 'pipeline-tracker-sidebar';
  sidebar.innerHTML = getSidebarHTML();
  gmailContainer.parentElement.appendChild(sidebar);

  document.body.style.overflow = 'hidden';
  const mainContent = document.querySelector('[role="main"]');
  if (mainContent) {
    mainContent.style.marginRight = '360px';
  }

  injectToggleButton();
  loadSidebarScript();
}

function injectToggleButton() {
  const toolbar =
    document.querySelector('.aeH') ||
    document.querySelector('[gh="tm"]') ||
    document.querySelector('header');

  if (!toolbar || document.getElementById('pt-toggle-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'pt-toggle-btn';
  btn.className = 'pt-toggle-btn';
  btn.innerHTML = '<span class="pt-toggle-dot"></span> Loop Back on';

  let sidebarVisible = true;
  btn.addEventListener('click', () => {
    const sidebar = document.getElementById('pipeline-tracker-sidebar');
    if (!sidebar) return;

    sidebarVisible = !sidebarVisible;
    sidebar.classList.toggle('pt-hidden');

    const mainContent = document.querySelector('[role="main"]');
    if (mainContent) {
      mainContent.style.marginRight = sidebarVisible ? '360px' : '0';
    }

    const dot = btn.querySelector('.pt-toggle-dot');
    dot.classList.toggle('pt-toggle-dot--off', !sidebarVisible);
    btn.innerHTML = '';
    btn.appendChild(dot);
    btn.append(sidebarVisible ? ' Loop Back on' : ' Loop Back off');
  });

  toolbar.appendChild(btn);
}

function loadSidebarScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/sidebar/sidebar.js');
  document.body.appendChild(script);
}

// --- Scan trigger management ---

chrome.runtime.sendMessage({ type: 'gmail_tab_active' });
chrome.runtime.sendMessage({ type: 'scan_requested' });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    chrome.runtime.sendMessage({ type: 'gmail_tab_active' });
    chrome.runtime.sendMessage({ type: 'scan_requested' });
  } else {
    chrome.runtime.sendMessage({ type: 'gmail_tab_inactive' });
  }
});

window.addEventListener('focus', () => {
  chrome.runtime.sendMessage({ type: 'gmail_tab_active' });
  chrome.runtime.sendMessage({ type: 'scan_requested' });
});

window.addEventListener('blur', () => {
  chrome.runtime.sendMessage({ type: 'gmail_tab_inactive' });
});

// --- Wait for Gmail to load, then inject ---

const observer = new MutationObserver(() => {
  if (document.querySelector('[role="main"]')) {
    observer.disconnect();
    injectSidebar();
  }
});
observer.observe(document.body, { childList: true, subtree: true });

if (document.querySelector('[role="main"]')) {
  injectSidebar();
}

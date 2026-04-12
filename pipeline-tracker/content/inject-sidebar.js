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
    <div class="pt-dues-row" id="pt-dues-row">
      <div class="pt-due">
        <div class="pt-due-label">Outgoing dues</div>
        <div class="pt-due-value" id="pt-outgoing-dues">$0</div>
      </div>
      <div class="pt-due">
        <div class="pt-due-label">Incoming dues</div>
        <div class="pt-due-value" id="pt-incoming-dues">$0</div>
      </div>
    </div>
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

  if (typeof refreshSidebar === 'function') {
    refreshSidebar();
  }
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

// --- Scan trigger management (guarded: extension reload invalidates context) ---

function loopBackPingScan() {
  const lb = window.loopBackChrome;
  if (!lb) return;
  void lb.sendMessage({ type: 'gmail_tab_active' }).catch(() => {});
  void lb.sendMessage({ type: 'scan_requested' }).catch(() => {});
}

function loopBackInactive() {
  const lb = window.loopBackChrome;
  if (!lb) return;
  void lb.sendMessage({ type: 'gmail_tab_inactive' }).catch(() => {});
}

loopBackPingScan();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loopBackPingScan();
  } else {
    loopBackInactive();
  }
});

window.addEventListener('focus', () => {
  loopBackPingScan();
});

window.addEventListener('blur', () => {
  loopBackInactive();
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

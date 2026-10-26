/* ══════════════════════════════════════════════
   PIMS — Piping Software Gateway — gateway.js
   ══════════════════════════════════════════════ */

// ─── AUTH (real PIMS session, same pattern as every other page) ──
// Redirects to the Gateway's own login (not PIMS's /index.html) — arriving
// here means the user entered through the Gateway, so an expired session or
// a manual sign-out should return them to the same front door, not the
// generic PIMS one. Every other PIMS page keeps redirecting to /index.html
// as before; this is the one page that's different, by design.
// Real session data only — /api/me returns { id, name, isHod, isSgl, roles }.
// There's no "designation" field anywhere in PIMS today, so the topbar
// profile's subtitle is built from the actual roles array (falls back to a
// generic label only if that array is somehow empty), never a fabricated
// job title.
function formatRoleSubtitle(me) {
  const parts = [];
  if (me.isHod) parts.push('HOD');
  if (Array.isArray(me.roles)) parts.push(...me.roles);
  const unique = [...new Set(parts)];
  return unique.length ? unique.join(', ') : 'PIMS User';
}

async function doLogout() {
  try { await fetch('/api/logout', { method: 'POST' }); } catch (_) {}
  window.location.href = '/gateway-login.html';
}

(async function () {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/gateway-login.html'; return; }
    const me = await res.json();

    const sidebarEl = document.getElementById('sidebarUser');
    if (sidebarEl && me && me.name) sidebarEl.textContent = `${me.name} (${me.id})`.toUpperCase().slice(0, 24);

    const nameEl = document.getElementById('topbarUserName');
    const roleEl = document.getElementById('topbarUserRole');
    if (nameEl && me && me.name) nameEl.textContent = me.name;
    if (roleEl && me) roleEl.textContent = formatRoleSubtitle(me);

    const aiGreetEl = document.getElementById('aiGreetName');
    if (aiGreetEl && me && me.name) aiGreetEl.textContent = me.name.split(' ')[0];

    if (me && me.name && typeof window.__setHeroGreeting === 'function') {
      window.__setHeroGreeting(me.name.split(' ')[0]);
    }
  } catch {
    window.location.href = '/gateway-login.html';
    return;
  }

  document.getElementById('logoutBtn')?.addEventListener('click', doLogout);
  document.getElementById('topbarLogoutBtn')?.addEventListener('click', doLogout);
})();

// ─── TOPBAR PROFILE DROPDOWN ───────────────────
(function () {
  const wrap = document.getElementById('topbarProfile');
  const btn  = document.getElementById('topbarProfileBtn');
  if (!wrap || !btn) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) wrap.classList.remove('open');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') wrap.classList.remove('open');
  });
})();

// ─── CHANGE PASSWORD MODAL ─────────────────────
// Real, wired to /api/change-password — same endpoint dashboard.html's
// modal already uses. Redirects to /gateway-login.html on success rather
// than /index.html, matching this page's own logout convention.
(function () {
  const btn       = document.getElementById('gwChangePasswordBtn');
  const modalBg   = document.getElementById('cpwModalBg');
  const closeBtn  = document.getElementById('cpwClose');
  const cancelBtn = document.getElementById('cpwCancel');
  const form      = document.getElementById('cpwForm');
  const msg       = document.getElementById('cpwMsg');
  if (!btn || !modalBg || !form) return;

  function openModal() {
    document.getElementById('topbarProfile')?.classList.remove('open');
    form.reset();
    msg.textContent = ''; msg.className = 'cpw-msg';
    modalBg.classList.add('open');
  }
  function closeModal() { modalBg.classList.remove('open'); }

  btn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modalBg.addEventListener('click', (e) => { if (e.target === modalBg) closeModal(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur  = document.getElementById('cpwCurrent').value.trim();
    const nw   = document.getElementById('cpwNew').value;
    const conf = document.getElementById('cpwConfirm').value;
    msg.textContent = ''; msg.className = 'cpw-msg';
    if (!cur || !nw || !conf) { msg.textContent = 'All fields are required.'; msg.className = 'cpw-msg err'; return; }
    if (nw !== conf) { msg.textContent = 'New passwords do not match.'; msg.className = 'cpw-msg err'; return; }
    if (nw.length < 6) { msg.textContent = 'Password must be at least 6 characters.'; msg.className = 'cpw-msg err'; return; }
    try {
      const res = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cur, newPassword: nw }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        msg.textContent = 'Password changed. Redirecting to login…'; msg.className = 'cpw-msg ok';
        setTimeout(() => { window.location.href = '/gateway-login.html'; }, 1600);
      } else {
        msg.textContent = data.message || 'Failed to change password.'; msg.className = 'cpw-msg err';
      }
    } catch (_) {
      msg.textContent = 'Network error. Please try again.'; msg.className = 'cpw-msg err';
    }
  });
})();

// ─── THEME TOGGLE ─────────────────────────────
// Light is the default (no attribute) — matches the page's normal Blue &
// White look. [data-theme="dark"] is the real dark palette (see
// gateway-userstyle.css's file-header comment for where its colors come
// from). Flipped from the old dark-default/light-override scheme this
// button used to drive back when gateway.css (dark-HUD) was the loaded
// stylesheet.
(function () {
  const root  = document.documentElement;
  const btn   = document.getElementById('themeToggle');
  if (!btn) return;
  const saved = localStorage.getItem('eil-theme');
  if (saved === 'dark') root.setAttribute('data-theme', 'dark');

  btn.addEventListener('click', () => {
    const isDark = root.getAttribute('data-theme') === 'dark';
    if (isDark) {
      root.removeAttribute('data-theme');
      localStorage.setItem('eil-theme', 'light');
    } else {
      root.setAttribute('data-theme', 'dark');
      localStorage.setItem('eil-theme', 'dark');
    }
  });
})();

// ─── SIDEBAR TOGGLE ───────────────────────────
(function () {
  const layout   = document.getElementById('layout');
  const backdrop = document.getElementById('sidebarBackdrop');
  const toggleBtn = document.getElementById('sidebarToggle');
  const MOBILE_BP = 860;

  function isMobile() { return window.innerWidth <= MOBILE_BP; }

  toggleBtn.addEventListener('click', () => {
    if (isMobile()) {
      layout.classList.toggle('sidebar-open');
    } else {
      layout.classList.toggle('sidebar-collapsed');
    }
  });

  backdrop.addEventListener('click', () => {
    layout.classList.remove('sidebar-open');
  });

  // Clean up classes when viewport crosses breakpoint
  window.addEventListener('resize', () => {
    if (!isMobile()) {
      layout.classList.remove('sidebar-open');
    } else {
      layout.classList.remove('sidebar-collapsed');
    }
  });
})();

// ─── INFO RAIL COLLAPSE TOGGLE ─────────────────
// Same width:0 collapse pattern as the left sidebar's own toggle above,
// mirrored for the right side. Lives in the icon rail (not on the info
// rail itself) so it's still reachable once collapsed.
(function () {
  const layout = document.getElementById('layout');
  const toggleBtn = document.getElementById('infoRailToggle');
  if (!layout || !toggleBtn) return;

  toggleBtn.addEventListener('click', () => {
    const collapsed = layout.classList.toggle('info-rail-collapsed');
    toggleBtn.title = collapsed ? 'Expand panel' : 'Collapse panel';
  });
})();

// ─── GLOBAL SEARCH (placeholder — no backend yet) ─────
// Opens the dropdown on focus/typing so the category layout (Lines / Line
// Items / MDS Documents) is visible and feels real, but each category just
// says "Not connected yet" — no fabricated results. Wire up one category
// at a time once a real search endpoint exists, same pattern as the KPIs.
(function () {
  const wrap  = document.getElementById('topbarSearch');
  const input = document.getElementById('globalSearchInput');
  if (!wrap || !input) return;

  input.addEventListener('focus', () => wrap.classList.add('active'));
  input.addEventListener('input', () => wrap.classList.add('active'));

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) wrap.classList.remove('active');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { wrap.classList.remove('active'); input.blur(); }
  });

  // Ctrl/Cmd+K focuses + opens search from anywhere on the page, including
  // while another input has focus — deliberately registered here (capture
  // phase not needed) rather than skipped by the "ignore typing in inputs"
  // guard the launch-shortcut listener below uses.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      wrap.classList.add('active');
      input.focus();
      input.select();
    }
  });
})();

// ─── SEARCH DROPDOWN — VIEWS QUICK-SWITCH ─────
// The "Views" category in the search dropdown is real (unlike Lines/Line
// Items/MDS below it) — typing filters the 3 view names, clicking one jumps
// straight to that view via the switcher's exposed window.__setGatewayView.
(function () {
  const list  = document.getElementById('searchViewList');
  const input = document.getElementById('globalSearchInput');
  const wrap  = document.getElementById('topbarSearch');
  if (!list || !input) return;

  const items = Array.from(list.querySelectorAll('.search-view-item'));

  function filterViews() {
    const q = input.value.trim().toLowerCase();
    items.forEach(item => {
      const match = !q || item.textContent.toLowerCase().includes(q);
      item.style.display = match ? '' : 'none';
    });
  }
  input.addEventListener('input', filterViews);

  items.forEach(item => {
    item.addEventListener('click', () => {
      if (typeof window.__setGatewayView === 'function') window.__setGatewayView(item.dataset.view);
      wrap?.classList.remove('active');
      input.value = '';
      filterViews();
      input.blur();
    });
  });
})();

// ─── VIEW SWITCHER (icon rail) ─────────────────
// Replaces the old always-visible right rail — clicking an icon shows
// exactly one .view-panel (Progress Summary / Pending Works / Monitoring)
// in the main area and hides the others. Hero title/subtitle swap to match.
(function () {
  const rail = document.getElementById('iconRail');
  if (!rail) return;

  const buttons     = Array.from(rail.querySelectorAll('.icon-rail-btn'));
  const panels      = Array.from(document.querySelectorAll('.view-panel'));
  const heroTitle   = document.getElementById('viewHeroTitle');
  const heroSub     = document.getElementById('viewHeroSub');
  const heroFilters = document.getElementById('heroFilters');

  // Progress view's hero is a personal greeting, not a static title, so it
  // needs its own renderer (name/time-of-day are injected into spans, not
  // baked into a fixed HTML string like the other two views below).
  let greetingName = null; // set by the AUTH block via window.__setHeroGreeting once /api/me resolves
  function getGreetingPeriod() {
    const h = new Date().getHours();
    return h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
  }
  function renderProgressHero() {
    if (!heroTitle || !heroSub) return;
    heroTitle.classList.add('hero-title--greeting');
    heroTitle.innerHTML = 'Good <span id="heroGreetPeriod"></span>, <span id="heroGreetName"></span>! <span class="hero-wave">👋</span>';
    document.getElementById('heroGreetPeriod').textContent = getGreetingPeriod();
    document.getElementById('heroGreetName').textContent = greetingName || 'there';
    heroSub.textContent = "Here's what's happening with your projects today.";
  }

  const VIEW_META = {
    pending:    { title: 'PENDING <span class="accent-word">WORKS</span>',
                  sub: 'Open tasks across the project — sample data, not connected to a real queue yet.' },
    monitoring: { title: '<span class="accent-word">MONITORING</span>',
                  sub: 'Recent system activity — sample events, not connected yet.' },
  };

  const LAST_VIEW_KEY = 'eil-gateway-last-view';

  function setView(view, opts) {
    if (view !== 'progress' && !VIEW_META[view]) return;
    buttons.forEach(b => b.classList.toggle('active', b.dataset.view === view));
    panels.forEach(p => p.classList.toggle('active', p.dataset.view === view));
    if (heroFilters) heroFilters.classList.toggle('active', view === 'progress');

    if (view === 'progress') {
      renderProgressHero();
    } else {
      const meta = VIEW_META[view];
      if (heroTitle && heroSub) {
        heroTitle.classList.remove('hero-title--greeting');
        heroTitle.innerHTML = meta.title;
        heroSub.textContent = meta.sub;
      }
    }
    if (!opts || !opts.skipSave) localStorage.setItem(LAST_VIEW_KEY, view);
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  // Exposed intentionally so other independent widgets (search dropdown's
  // Views quick-switch) can trigger a view change without re-implementing
  // the panel/hero-swap logic above.
  window.__setGatewayView = setView;

  // Called by the AUTH block once /api/me resolves with the real user name.
  // Re-renders immediately if Progress is the active view so the "there"
  // placeholder never lingers once the real name is known; if another view
  // is active, the name is just cached for whenever the user switches back.
  window.__setHeroGreeting = function (name) {
    greetingName = name;
    if (!document.querySelector('.icon-rail-btn.active') || document.querySelector('.icon-rail-btn.active')?.dataset.view === 'progress') {
      renderProgressHero();
    }
  };

  // Restore whichever view the user was last on (per-browser, not per-user —
  // same localStorage pattern as the theme toggle above). Falls through
  // silently to the HTML's default ("progress") if nothing saved yet or the
  // saved value is stale/invalid.
  const savedView = localStorage.getItem(LAST_VIEW_KEY);
  if (savedView && savedView !== 'progress' && VIEW_META[savedView]) {
    setView(savedView, { skipSave: true });
  } else {
    renderProgressHero();
  }
})();

// ─── ICON RAIL BADGES ──────────────────────────
// Counts how many rows in each static panel need attention (blocked Pending
// Works tickets, flagged/"risk" Monitoring events) and shows it as a badge
// on the matching icon-rail button. Counted live from the DOM each call, so
// it always matches whatever rows are actually listed — never a separate
// hardcoded number to keep in sync.
function setRailBadge(view, count) {
  const btn = document.querySelector(`.icon-rail-btn[data-view="${view}"]`);
  if (!btn) return;
  let badge = btn.querySelector('.icon-rail-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'icon-rail-badge';
      btn.appendChild(badge);
    }
    badge.textContent = count > 9 ? '9+' : String(count);
  } else if (badge) {
    badge.remove();
  }
}

(function () {
  const blockedCount = document.querySelectorAll('#view-pending .ticket-status.blocked').length;
  const riskCount = document.querySelectorAll('#view-monitoring .activity-dot.risk').length;
  setRailBadge('pending', blockedCount);
  setRailBadge('monitoring', riskCount);
})();

// ─── STATUS STRIP → KPI TILE CLICK-THROUGH ────
// Clicking a status chip scrolls its matching KPI card into view and gives
// it a brief highlight, so the at-a-glance strip doubles as a jump-to-detail
// index instead of being purely read-only. Chips only ever render inside
// the Progress Summary view, so the target tile is always in the DOM and
// (once that view is active) visible — no view-switch needed here.
(function () {
  const CHIP_TARGETS = {
    'iso-issued':      'kpi-iso-issued',
    'model-review':    'kpi-model-review',
    'line-modelling':  'kpi-line-modelling',
    'iso-worked':      'kpi-iso-worked',
    'ppms':            'kpi-ppms-progress',
    'special-support': 'kpi-special-support',
    'gad':              'kpi-gad',
    'nozzle':           'kpi-nozzle',
    'clip-drawings':    'kpi-clip-drawings',
    'mds':              'kpi-mds-availability',
    'vendor-drawings':  'kpi-vendor-drawings',
    'mr-released':      'kpi-mr-released',
    'dept-hold':        'kpi-dept-hold',
  };

  document.querySelectorAll('.status-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const targetId = CHIP_TARGETS[chip.dataset.metric];
      const target = targetId && document.getElementById(targetId);
      if (!target) return;

      if (typeof window.__setGatewayView === 'function') window.__setGatewayView('progress');

      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.remove('kpi-tile-flash');
      // Force reflow so re-triggering the animation on a second click of the
      // same chip restarts it instead of being a no-op (class already set).
      void target.offsetWidth;
      target.classList.add('kpi-tile-flash');
      setTimeout(() => target.classList.remove('kpi-tile-flash'), 1100);
    });
  });
})();

// ─── LAUNCH APP ───────────────────────────────
// Every module (including PIMS itself) opens in a new tab — the Gateway
// stays open in the original tab so it acts as a persistent launcher. The
// sidebar SYSTEMS list is the only launcher now (no app-card grid on the
// page); items without data-url (PPMS, IPMCS, Add Application) get no
// click handler at all, per .sys-item--soon / .sys-item--add in gateway.css.
function launchApp(url, name) {
  if (!url || url === '#') return;

  const overlay = document.getElementById('launchOverlay');
  const msg     = document.getElementById('launchMsg');
  msg.textContent = `Connecting to ${name}…`;
  overlay.classList.add('active');

  setTimeout(() => { window.open(url, '_blank'); }, 800);
  setTimeout(() => { overlay.classList.remove('active'); }, 1500);
}

// ─── SIDEBAR SYSTEM LAUNCH ────────────────────
const launchableItems = Array.from(document.querySelectorAll('.sys-item[data-url]'));
launchableItems.forEach(item => {
  item.addEventListener('click', () => {
    launchApp(item.dataset.url, item.dataset.name || item.querySelector('.sys-code')?.textContent.trim());
    if (window.innerWidth <= 860) {
      document.getElementById('layout').classList.remove('sidebar-open');
    }
  });
});

// ─── SIDEBAR MODULE COLLAPSE ──────────────────
// A collapse chevron is attached to whichever element directly precedes a
// run of .sys-subitem links — either a .sys-item (main module row stays
// visible/clickable, only ITS subitems collapse) or a .sys-group-label (no
// separate main-module row, the group header itself is the toggle and
// everything under it collapses together). Which pattern applies to a
// given group is read from the DOM, not hardcoded, so restructuring
// another module the same way later needs no changes here. Default state
// is COLLAPSED. moduleGroups collects every collapsible {trigger, btn} in
// DOM (top-to-bottom) order — used by the keyboard shortcuts below to jump
// to the Nth module regardless of whether it's a .sys-item or
// .sys-group-label trigger.
const moduleGroups = [];
(function () {
  function makeCollapsible(trigger, stopClickPropagation) {
    const subitems = [];
    let sib = trigger.nextElementSibling;
    while (sib && sib.classList.contains('sys-subitem')) {
      subitems.push(sib);
      sib = sib.nextElementSibling;
    }
    if (!subitems.length) return;

    // .sys-group-label starts as plain text — give it the same icon+row
    // treatment .sys-item rows have always had, so a collapsible group
    // header reads as a proper clickable module row instead of a small
    // meta label. .sys-item is left untouched (already has its own
    // dot/code/tag markup).
    if (trigger.classList.contains('sys-group-label')) {
      const text = trigger.textContent.trim();
      trigger.textContent = '';
      const icon = document.createElement('span');
      icon.className = 'sgl-icon';
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>';
      const label = document.createElement('span');
      label.className = 'sgl-text';
      label.textContent = text;
      trigger.appendChild(icon);
      trigger.appendChild(label);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sys-collapse-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.title = 'Expand';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
    trigger.appendChild(btn);
    trigger.classList.add('sys-collapsed');
    subitems.forEach((s) => s.classList.add('sys-subitem-hidden'));

    btn.addEventListener('click', (e) => {
      if (stopClickPropagation) e.stopPropagation(); // don't also fire the module's own launch click
      const collapsed = trigger.classList.toggle('sys-collapsed');
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.title = collapsed ? 'Expand' : 'Collapse';
      subitems.forEach((s) => s.classList.toggle('sys-subitem-hidden', collapsed));
    });

    moduleGroups.push({ trigger, btn });
  }

  // Combined selector (not two separate querySelectorAll calls) so results
  // come back in true top-to-bottom DOM order regardless of which pattern
  // each group uses — needed for moduleGroups to match the sidebar's
  // visual order for the keyboard shortcuts below.
  document.querySelectorAll('.sys-item, .sys-group-label').forEach((el) => {
    makeCollapsible(el, el.classList.contains('sys-item'));
  });
})();

// ─── KEYBOARD SHORTCUTS ───────────────────────
// Number keys 1-9 jump to a main module: expand it if it's currently
// toggling it collapsed/expanded each press (same as clicking its
// chevron), then scroll it into view. Order matches the sidebar's visual
// top-to-bottom order (moduleGroups, built above).
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const idx = parseInt(e.key) - 1;
  if (idx >= 0 && idx < moduleGroups.length) {
    const { trigger, btn } = moduleGroups[idx];
    btn.click();
    trigger.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (e.key === 'Escape') {
    document.getElementById('launchOverlay').classList.remove('active');
    document.getElementById('layout').classList.remove('sidebar-open');
  }
});

// ─── PROGRESS SUMMARY — DEMO DATA REVEAL ──────
// Arbitrary illustrative numbers, not a real feed. Populated 2s after load
// so the mosaic reads as a working dashboard for presentation purposes —
// see KPI-connection plan in project memory for the real, one-at-a-time
// backend wiring this will eventually be replaced with.
function setGauge(tileId, percent, circumference, mainText, smallText, captionId, captionText) {
  const tile = document.getElementById(tileId);
  if (!tile) return;
  const sweep = tile.querySelector('.kpi-ring-sweep');
  if (sweep) {
    const arc = +(circumference * percent / 100).toFixed(1);
    const rest = +(circumference - arc).toFixed(1);
    sweep.style.animation = 'none';
    sweep.style.transition = 'none';
    sweep.setAttribute('stroke-dasharray', `${arc} ${rest}`);
  }
  const valueEl = tile.querySelector('.kpi-gauge-value');
  if (valueEl && mainText != null) {
    valueEl.firstChild.textContent = mainText;
    const small = valueEl.querySelector('small');
    if (small && smallText) small.textContent = smallText;
  }
  if (captionId && captionText) {
    const cap = document.getElementById(captionId);
    if (cap) cap.textContent = captionText;
  }
}

function setStackedBars(tileId, buckets) {
  // buckets: [[modelled, total], ...] — bar height reflects each bucket's
  // total (scaled against the largest bucket), split internally into a
  // bright "modelled" segment and a dim "remaining" segment.
  const maxTotal = Math.max(...buckets.map(b => b[1]));
  document.querySelectorAll(`#${tileId} .bar-col`).forEach((col, i) => {
    const bucket = buckets[i];
    if (!bucket) return;
    const [modelled, total] = bucket;
    const remaining = total - modelled;
    const stack = col.querySelector('.bar-stack');
    if (!stack) return;
    stack.style.height = Math.round((total / maxTotal) * 88) + '%';
    stack.querySelector('.bar-remaining').style.height = Math.round((remaining / total) * 100) + '%';
    stack.querySelector('.bar-modelled').style.height = Math.round((modelled / total) * 100) + '%';
    const val = document.createElement('span');
    val.className = 'bar-value';
    val.textContent = `${modelled}/${total}`;
    col.insertBefore(val, stack);
  });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function setComboChart(tileId, weeklyValues) {
  // Weekly bars scaled to the tallest week; an overlaid cumulative line
  // scaled independently to the running total, sharing the same baseline.
  const baseline = 140, barMaxH = 100, lineMaxH = 120;
  const maxWeekly = Math.max(...weeklyValues);
  let running = 0;
  const cumulative = weeklyValues.map(v => (running += v));
  const maxCumulative = cumulative[cumulative.length - 1];

  const bars = document.querySelectorAll(`#${tileId} #kpi-iso-bars .combo-bar`);
  const valuesGroup = document.getElementById('kpi-iso-bar-values');
  const dotsGroup = document.getElementById('kpi-iso-cum-dots');
  const points = [];

  // Real calendar week-ending dates, most recent = today.
  const today = new Date();
  const labelEls = document.querySelectorAll(`#${tileId} .kpi-combo-labels span`);
  labelEls.forEach((el, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - 7 * (labelEls.length - 1 - i));
    el.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  bars.forEach((bar, i) => {
    const v = weeklyValues[i];
    if (v == null) return;
    const h = Math.round((v / maxWeekly) * barMaxH);
    const x = parseFloat(bar.getAttribute('x'));
    const w = parseFloat(bar.getAttribute('width'));
    bar.setAttribute('y', baseline - h);
    bar.setAttribute('height', h);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'combo-bar-value');
    label.setAttribute('x', x + w / 2);
    label.setAttribute('y', baseline - h - 6);
    label.textContent = v;
    valuesGroup.appendChild(label);

    const cy = baseline - Math.round((cumulative[i] / maxCumulative) * lineMaxH);
    points.push(`${x + w / 2},${cy}`);

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('class', 'combo-dot');
    dot.setAttribute('cx', x + w / 2);
    dot.setAttribute('cy', cy);
    dot.setAttribute('r', 2.5);
    dotsGroup.appendChild(dot);
  });

  const pointsStr = points.join(' ');
  document.querySelector(`#${tileId} .kpi-combo-line-track`).setAttribute('points', pointsStr);
  document.getElementById('kpi-iso-cum-line').setAttribute('points', pointsStr);

  return { total: maxCumulative };
}

// STATUS_RULES: placeholder thresholds only — tune once real per-metric
// targets are agreed with the GL/HOD. Percent metrics: >=75 good, 50-74
// watch, <50 risk. "dept-hold" is a count where lower is better, so its
// scale is inverted (see setStatusStrip). Delete this + setStatusStrip()
// + #statusStrip in gateway.html/gateway.css to fully revert the strip.
function classifyPercent(pct) {
  if (pct >= 75) return 'good';
  if (pct >= 50) return 'watch';
  return 'risk';
}

function setStatusStrip() {
  // iso-issued/line-modelling/ppms/gad/nozzle/clip-drawings are promoted to
  // the .kpi-highlight-row cards above — see setHighlightCards(). Everything
  // else, including model-review, stays in this flat chip strip.
  const metrics = [
    ['model-review',    '30%', classifyPercent(30)],
    ['iso-worked',      '224', 'info'],
    ['special-support', '64%', classifyPercent(64)],
    ['mds',             '74%', classifyPercent(74)],
    ['vendor-drawings', '47%', classifyPercent(47)],
    ['mr-released',     '61%', classifyPercent(61)],
    ['dept-hold',       '30',  30 >= 30 ? 'risk' : (30 >= 15 ? 'watch' : 'good')],
  ];
  metrics.forEach(([key, text, status]) => {
    const chip = document.querySelector(`.status-chip[data-metric="${key}"]`);
    if (!chip) return;
    chip.setAttribute('data-status', status);
    chip.querySelector('.status-chip-value').textContent = text;
  });
}

// Highlight cards — same 6 metrics/values already used elsewhere on this
// page (iso-issued/line-modelling/gad/nozzle captions, ppms gauge), just
// paired here with a fraction + a trend delta for the card layout. The
// deltas are the same kind of arbitrary illustrative numbers as the rest of
// revealDemoData() — not a real week-over-week comparison.
function setHighlightCards() {
  const cards = [
    ['iso-issued',     '77%', '86 of 112', 'up', '12%'],
    ['line-modelling', '65%', '493/755',   'up', '8%'],
    ['ppms',           '64%', '14/22',     'up', '14%'],
    ['gad',            '72%', '18/25',     'up', '9%'],
    ['nozzle',         '91%', '42/46',     'up', '18%'],
    ['clip-drawings',  '58%', '67/115',    'up', '4%'],
  ];
  cards.forEach(([key, pct, frac, dir, delta]) => {
    const valueEl = document.getElementById(`hl-${key}-value`);
    const subEl = document.getElementById(`hl-${key}-sub`);
    if (valueEl) valueEl.textContent = pct;
    if (subEl) {
      const arrow = dir === 'up' ? '↑' : '↓';
      const cls = dir === 'up' ? 'trend-up' : 'trend-down';
      subEl.innerHTML = `${frac} <span class="${cls}">${arrow} ${delta}</span>`;
    }
  });
}

function setBarChart(tileId, values, captionId, captionText) {
  const max = Math.max(...values);
  document.querySelectorAll(`#${tileId} .bar-col`).forEach((col, i) => {
    const bar = col.querySelector('.bar');
    if (!bar || values[i] == null) return;
    bar.style.height = Math.round((values[i] / max) * 88) + '%';
    const val = document.createElement('span');
    val.className = 'bar-value';
    val.textContent = values[i];
    col.insertBefore(val, bar);
  });
  if (captionId && captionText) {
    const cap = document.getElementById(captionId);
    if (cap) cap.textContent = captionText;
  }
}

function revealDemoData() {
  setStatusStrip();
  setHighlightCards();
  const asOfToday = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  setGauge('kpi-ppms-progress', 64, 238.8, '14/22', 'completed', 'kpi-ppms-caption', `${asOfToday} · 64% complete`);
  setGauge('kpi-special-support', 64, 226.2, '9/14', 'issued', 'kpi-special-support-caption', '64% issued');
  setGauge('kpi-gad', 72, 226.2, '18/25', 'issued', 'kpi-gad-caption', '72% issued');
  setGauge('kpi-nozzle', 91, 226.2, '42/46', 'issued', 'kpi-nozzle-caption', '91% issued');
  setGauge('kpi-clip-drawings', 58, 226.2, '58%', null, 'kpi-clip-drawings-caption', '67 / 115 issued');
  setGauge('kpi-mds-availability', 74, 226.2, '74%', null, 'kpi-mds-availability-caption', '89 / 120 available');
  setGauge('kpi-vendor-drawings', 47, 226.2, '47%', null, 'kpi-vendor-drawings-caption', '38 / 81 received');
  setGauge('kpi-mr-released', 61, 226.2, '11/18', 'released', 'kpi-mr-released-caption', '61% released');

  // Model Review Status — milestone timeline
  const mrBar = document.querySelector('#kpi-model-review .kpi-milestone-bar');
  if (mrBar) {
    mrBar.querySelector('.done').style.width = '30%';
    mrBar.querySelector('.planned').style.width = '30%';
    mrBar.querySelector('.unplanned').style.width = '30%';
  }
  document.getElementById('kpi-mr-done-pct').textContent = '30%';
  document.getElementById('kpi-mr-done-dates').textContent = 'Jan 5 – Apr 18, 2026';
  document.getElementById('kpi-mr-planned-pct').textContent = '60%';
  document.getElementById('kpi-mr-planned-dates').textContent = 'Apr 19 – Sep 30, 2026';
  document.getElementById('kpi-mr-unplanned-pct').textContent = '90%';
  document.getElementById('kpi-mr-unplanned-dates').textContent = 'Dates not yet planned';

  // ISO Issued / Total ISO — revision-wise breakdown (Rev 0..Rev 4+)
  setBarChart('kpi-iso-issued', [41, 27, 12, 4, 2], 'kpi-iso-issued-caption', '86 of 112 total · 77% issued');

  // Line Modelling Status — modelled/total headline + per-size-range stacked bars
  document.getElementById('kpi-lm-fraction').textContent = '493 / 755';
  setStackedBars('kpi-line-modelling', [[93, 142], [203, 310], [134, 205], [63, 98]]);
  const lmCaption = document.getElementById('kpi-line-modelling-caption');
  if (lmCaption) lmCaption.textContent = '65% modelled overall';

  // ISO Worked On — weekly bars + cumulative achievement curve
  const { total: isoTotal } = setComboChart('kpi-iso-worked', [22, 28, 19, 34, 25, 31, 29, 36]);
  const isoWorkedCaption = document.getElementById('kpi-iso-worked-caption');
  if (isoWorkedCaption) isoWorkedCaption.textContent = `${isoTotal} ISOs issued over 8 weeks`;

  // Other Departments Hold — labels, counts, bar widths
  const deptData = [['Civil', 32, 6], ['Structural', 58, 11], ['Electrical', 20, 4], ['Instrumentation', 46, 9]];
  const deptMax = Math.max(...deptData.map(d => d[1]));
  document.querySelectorAll('#kpi-dept-hold .kpi-hbar-row').forEach((row, i) => {
    const [name, pct, count] = deptData[i] || [];
    if (!name) return;
    const label = document.createElement('span');
    label.className = 'kpi-hbar-label';
    label.textContent = name;
    row.insertBefore(label, row.firstChild);
    const fill = row.querySelector('.kpi-hbar-fill');
    if (fill) fill.style.width = Math.round((pct / deptMax) * 100) + '%';
    const countEl = document.createElement('span');
    countEl.className = 'kpi-hbar-count';
    countEl.textContent = count;
    row.appendChild(countEl);
  });
  const deptCaption = document.getElementById('kpi-dept-hold-caption');
  if (deptCaption) deptCaption.textContent = '30 lines on hold across 4 departments';
}

setTimeout(revealDemoData, 2000);

// ─── INFO RAIL — REAL DATA (Notifications / Stored Line Lists) ──
// Unlike the demo panels above, these two info-rail cards show genuinely
// live data — the same /api/notif feed the bell/panel use, and the same
// /api/linelist/jobs endpoint dashboard.html's "Stored Line Lists" table
// reads. No arbitrary numbers here.
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgoShort(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

async function loadInfoRailNotifications() {
  const container = document.getElementById('gwNotifList');
  if (!container) return;
  try {
    const res = await fetch('/api/notif');
    const data = await res.json();
    if (!data.ok || !data.notifications || !data.notifications.length) {
      container.innerHTML = '<span class="kpi-caption">No notifications yet</span>';
      return;
    }
    container.innerHTML = data.notifications.slice(0, 4).map(n => `
      <div class="activity-row" data-notif-row style="cursor:pointer;">
        <span class="activity-dot ${n.is_read ? 'good' : 'info'}"></span>
        <span class="activity-text">${escHtml(n.title)}</span>
        <span class="activity-time">${timeAgoShort(n.created_at)}</span>
      </div>`).join('');
    container.querySelectorAll('[data-notif-row]').forEach(row => {
      row.addEventListener('click', () => document.getElementById('notifBell')?.click());
    });
  } catch (_) {
    container.innerHTML = '<span class="kpi-caption">Unable to load notifications</span>';
  }
}

// ─── RECENTLY ACCESSED — device-local, no backend ─────────────────────
// Replaces the old "Stored Line Lists" info-rail panel. Tracks clicks on
// sidebar module/sub-module links in localStorage, most-recent first,
// deduped by href (re-opening something moves it to the top instead of
// creating a duplicate row) and capped at RECENT_MAX. Nothing here is
// server data — it only reflects what's been clicked on this device.
const RECENT_KEY = 'gw-recent-access';
const RECENT_MAX = 8;

function getRecentAccess() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

function trackRecentAccess(name, href) {
  if (!href || href === '#' || !name) return;
  let list = getRecentAccess().filter((r) => r.href !== href);
  list.unshift({ name, href, ts: Date.now() });
  list = list.slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (_) {}
}

function loadInfoRailRecent() {
  const container = document.getElementById('gwRecentList');
  if (!container) return;
  const list = getRecentAccess();
  if (!list.length) {
    container.innerHTML = '<span class="kpi-caption">Nothing opened yet this session</span>';
    return;
  }
  container.innerHTML = list.map((r) => `
    <a class="recent-row" href="${escHtml(r.href)}" target="_blank" style="text-decoration:none;">
      <span class="recent-icon xlsx">${escHtml(r.name.slice(0, 2).toUpperCase())}</span>
      <span class="recent-text">
        <span class="recent-name">${escHtml(r.name)}</span>
        <span class="recent-sub">${timeAgoShort(new Date(r.ts).toISOString())}</span>
      </span>
    </a>`).join('');
}

// Track every sidebar module/sub-module link — plain .sys-subitem[href]
// links (the current pattern every module uses) and any .sys-item[data-url]
// row still around (launchableItems, empty today but kept future-proof).
document.querySelectorAll('.sys-subitem[href]').forEach((el) => {
  el.addEventListener('click', () => {
    trackRecentAccess(el.textContent.trim(), el.getAttribute('href'));
    loadInfoRailRecent();
  });
});
launchableItems.forEach((item) => {
  item.addEventListener('click', () => {
    trackRecentAccess(item.dataset.name || item.querySelector('.sys-code')?.textContent.trim(), item.dataset.url);
    loadInfoRailRecent();
  });
});

loadInfoRailNotifications();
loadInfoRailRecent();

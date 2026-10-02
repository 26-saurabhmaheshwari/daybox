/* DayBox UI. Logic lives in core.js (window.DBX); this file is DOM + state + sync. */
(function () {
'use strict';
const X = window.DBX;
const { pad, dkey, addDays, dow, weekStart, hm, toMin, durTxt, hrs, clamp, clone, uid, DOW, norm, zoneOf, catOf } = X;
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmtShort = k => { const d = X.parseKey(k); return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; };
const fmtLong = k => { const d = X.parseKey(k); return DOWL[d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); };
const today = () => dkey(new Date());
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const isPhone = () => matchMedia('(max-width:820px)').matches;

/* ---------- storage ---------- */
const LS_CFG = 'dbx_config_v1', LS_DAY = 'dbx_d_', LS_DIRTY = 'dbx_dirty_v1', LS_VIEW = 'dbx_view_v1', LS_DISMISS = 'dbx_dismiss_v1', LS_ONB = 'dbx_onboarded_v1';
const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Browser storage is full. Export a backup.'); } };

const RAW0 = load(LS_CFG);
const MIGRATED = !!(RAW0 && (RAW0.templates || []).some(t => !t.deleted));  // templates -> recurring blocks, saved once below
let CFG = X.mergeConfig(RAW0);
const DAYS = {};
Object.keys(localStorage).filter(k => k.startsWith(LS_DAY)).forEach(k => { const d = load(k); if (d && d.date) DAYS[d.date] = d; });
const STORE = { days: DAYS };
let TF = loadTenfoldLocal();
let INBOX = null;
let AUTH = { signedIn: false };
let SYNC = { state: 'local', msg: '' };
let VIEW = localStorage.getItem(LS_VIEW) || 'today';
let CUR = today();
let WEEK = weekStart(today());
let PLAN_WS = null;
let TAB = { bank: 'regular', routine: 'templates', insights: '7' };
let SCROLL_NOW = true;
let DRAGGING = false;
let TIPS_OPEN = false, AG_DAY = null;
const UNLOCKED = new Set();  // marked blocks unlocked for one edit; cleared when the editor closes or a drag ends
const isMarked = b => !!b.status && b.status !== 'planned';

// Tenfold, read-only: same browser storage when both apps run on the same site (or both from file://)
function loadTenfoldLocal() {
  try {
    const g = JSON.parse(localStorage.getItem('ptd_goals2_v1') || 'null');
    const s = JSON.parse(localStorage.getItem('ptd_sanyam_v1') || 'null');
    const c = JSON.parse(localStorage.getItem('ptd_sanyamcfg_v1') || 'null');
    if (!g && !s && !c) return null;
    return { goals: Array.isArray(g) ? g : [], sanyam: Array.isArray(s) ? s : [], sanyamcfg: c && typeof c === 'object' ? c : {}, src: 'local' };
  } catch (e) { return null; }
}

/* ---------- save + sync ---------- */
const dirty = new Set(load(LS_DIRTY) || []);
let pushT = null;
const fsSafe = o => JSON.parse(JSON.stringify(o));
function markDirty(k) { dirty.add(k); put(LS_DIRTY, Array.from(dirty)); clearTimeout(pushT); pushT = setTimeout(flush, 900); }
async function flush() {
  if (!window.DBXFB || !DBXFB.uid || !dirty.size) return;
  setSync('saving');
  try {
    for (const k of Array.from(dirty)) {
      if (k === 'cfg') await DBXFB.pushConfig(fsSafe(CFG));
      else if (DAYS[k]) await DBXFB.pushDay(k, fsSafe(DAYS[k]));
      dirty.delete(k);
    }
    put(LS_DIRTY, Array.from(dirty));
    setSync('ok');
  } catch (e) { setSync('err', (e && (e.code || e.message)) || 'save failed'); }
}
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
function saveCfg() { CFG.updated = Date.now(); put(LS_CFG, CFG); markDirty('cfg'); }
function saveDay(d, auto) {
  d.virtual = false; delete d.untracked;
  X.lockIfDue(d, today());
  d.updated = auto ? 1 : Date.now();  // auto-created days must lose to real edits from another device
  DAYS[d.date] = d;
  put(LS_DAY + d.date, d);
  markDirty(d.date);
}
function day(date) { return X.getDay(STORE, CFG, date, today()); }
function ensureToday() {
  const t = today();
  if (!DAYS[t]) saveDay(X.buildDay(CFG, t), true);
  Object.values(DAYS).forEach(d => { if (X.lockIfDue(d, t)) { put(LS_DAY + d.date, d); markDirty(d.date); } });
}
function setSync(state, msg) { SYNC = { state, msg: msg || '' }; renderSync(); }

document.addEventListener('dbx-auth', e => {
  AUTH = e.detail || { signedIn: false };
  setSync(AUTH.signedIn ? 'loading' : 'local');
  if (VIEW === 'settings' || VIEW === 'saarthi') render(); else renderNav();
});
document.addEventListener('dbx-cloud', e => {
  const hadTpl = !!(e.detail && e.detail.config && (e.detail.config.templates || []).some(t => !t.deleted));
  const m = X.mergeCloud({ config: CFG, days: DAYS }, e.detail || {});
  if (m.config !== CFG) { CFG = X.mergeConfig(m.config); put(LS_CFG, CFG); if (hadTpl) saveCfg(); }
  Object.keys(m.days).forEach(k => { if (DAYS[k] !== m.days[k]) { DAYS[k] = m.days[k]; put(LS_DAY + k, DAYS[k]); } });
  if (m.pushConfig) markDirty('cfg');
  m.pushDays.forEach(markDirty);
  if (e.detail && 'inbox' in e.detail) INBOX = e.detail.inbox || null;
  ensureToday();
  setSync('ok');
  if (!e.detail || !e.detail.live || m.changed) { if (DRAGGING) setTimeout(render, 400); else render(); }
});
document.addEventListener('dbx-inbox', e => { INBOX = e.detail || null; renderNav(); if (VIEW === 'saarthi' || VIEW === 'today') render(); });
document.addEventListener('dbx-tenfold', e => { TF = e.detail; if (['bank', 'insights', 'today'].includes(VIEW)) render(); });
document.addEventListener('dbx-sync-error', e => { setSync('err', e.detail); toast(String(e.detail), null, null, 9000); });

/* ---------- icons ---------- */
const IC = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  week: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  plan: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  bank: '<path d="M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6L3.3 9.2l6.1-.6z"/>',
  routine: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/>',
  insights: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  saarthi: '<path d="M21 12a8 8 0 01-11.6 7.1L4 21l1.9-5.4A8 8 0 1121 12z"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  left: '<path d="M15 18l-6-6 6-6"/>', right: '<path d="M9 18l6-6-6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.5-2"/>',
  check: '<path d="M20 6L9 17l-5-5"/>', fill: '<path d="M4 6h16M4 12h10M4 18h7"/><path d="M18 15v6M15 18h6"/>',
  moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>', reset: '<path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8"/><path d="M3 3v5h5"/>',
};
const ic = (n, cls) => '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[n] + '</svg>';

const VIEWS = [
  { id: 'today', name: 'Today', ic: 'today' }, { id: 'week', name: 'Week', ic: 'week' }, { id: 'plan', name: 'Thursday plan', ic: 'plan' },
  { id: 'bank', name: 'Bank', ic: 'bank' }, { id: 'routine', name: 'Routine', ic: 'routine' }, { id: 'insights', name: 'Insights', ic: 'insights' },
  { id: 'saarthi', name: 'Saarthi', ic: 'saarthi' }, { id: 'settings', name: 'Settings', ic: 'settings' },
];
function setView(v) { VIEW = VIEWS.some(x => x.id === v) ? v : 'today'; localStorage.setItem(LS_VIEW, VIEW); if (VIEW === 'today') SCROLL_NOW = true; closeSheet(); render(); scrollTo(0, 0); }

/* ---------- toast + sheet ---------- */
let toastT = null;
function toast(msg, label, fn, ms) {
  const t = $('#toast');
  t.innerHTML = '<span>' + esc(msg) + '</span>' + (label ? '<button type="button">' + esc(label) + '</button>' : '');
  t.hidden = false;
  if (label) t.querySelector('button').onclick = () => { t.hidden = true; fn && fn(); };
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms || 4000);
}
function openSheet(html, bind) {
  const ov = $('#ov'), sh = $('#sheet');
  sh.innerHTML = html; ov.hidden = false;
  $$('[data-x]', sh).forEach(b => { b.onclick = closeSheet; });
  bind && bind(sh);
  const f = sh.querySelector('input[type=text],textarea,select'); if (f && !isPhone()) f.focus();
}
function closeSheet() { $('#ov').hidden = true; $('#sheet').innerHTML = ''; if (UNLOCKED.size) { UNLOCKED.clear(); if (typeof render === 'function') render(); } }
$('#ov').addEventListener('click', e => { if (e.target.id === 'ov') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#ov').hidden) closeSheet(); });

/* ---------- shell ---------- */
function applyTheme() { const t = CFG.settings.theme; if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
function pendingOps() { return INBOX && Array.isArray(INBOX.ops) ? INBOX.ops.filter(o => o.state === 'pending').length : 0; }
function unmarkedToday() {
  const d = DAYS[today()]; if (!d) return 0; const nm = nowMin();
  return d.blocks.filter(b => b.status === 'planned' && b.start + b.dur <= nm && b.cat !== 'sleep').length;
}
function renderNav() {
  const badge = { today: unmarkedToday(), saarthi: pendingOps() };
  $('#navList').innerHTML = VIEWS.map(v => '<button class="nv ' + (VIEW === v.id ? 'on' : '') + '" data-act="nav" data-v="' + v.id + '">' + ic(v.ic) + '<span>' + v.name + '</span>' + (badge[v.id] ? '<span class="badge">' + badge[v.id] + '</span>' : '') + '</button>').join('');
  const tabs = ['today', 'week', 'bank', 'insights'];
  $('#tabbar').innerHTML = tabs.map(id => { const v = VIEWS.find(x => x.id === id); return '<button class="' + (VIEW === id ? 'on' : '') + '" data-act="nav" data-v="' + id + '">' + ic(v.ic) + '<span>' + v.name + '</span></button>'; }).join('')
    + '<button class="' + (tabs.includes(VIEW) ? '' : 'on') + '" data-act="more">' + ic('more') + '<span>More' + (pendingOps() ? ' •' : '') + '</span></button>';
  $('#fab').innerHTML = ic('spark') + 'What now?';
  $('#fab').dataset.act = 'whatnow';
  $('#fab').hidden = true;
  renderSync();
}
function renderSync() {
  const el = $('#syncBox'); if (!el) return;
  const map = { local: ['', 'On this device only. Sign in to sync.'], loading: ['', 'Loading your data...'], saving: ['ok', 'Saving...'], ok: ['ok', 'Synced' + (AUTH.email ? ' · ' + AUTH.email : '')], err: ['err', 'Sync problem: ' + SYNC.msg] };
  const [cls, txt] = map[SYNC.state] || map.local;
  el.innerHTML = '<span class="dot ' + cls + '"></span>' + esc(txt) + (AUTH.signedIn ? '' : '<div style="margin-top:8px"><button class="btn sm" data-act="signin">Sign in with Google</button></div>');
}
function render() {
  applyTheme(); renderNav();
  const gw = $('.gwrap'); const sl = gw ? gw.scrollLeft : 0, st = gw ? gw.scrollTop : 0, gid = gw ? gw.id : null;
  const fn = { today: viewToday, week: viewWeek, plan: viewPlan, bank: viewBank, routine: viewRoutine, insights: viewInsights, saarthi: viewSaarthi, settings: viewSettings }[VIEW] || viewToday;
  const r = fn();
  $('#top').innerHTML = '<h1>' + r.title + (r.sub ? '<span class="sub">' + r.sub + '</span>' : '') + '</h1><div class="tact row">' + (r.actions || '') + '</div>';
  $('#view').innerHTML = r.body;
  const gw2 = $('.gwrap'); if (gw2 && gw2.id === gid) { gw2.scrollLeft = sl; gw2.scrollTop = st; }
  r.after && r.after();
}

/* ---------- timeline grid (day / week / template) ---------- */
function blockHtml(b, L, c, mode, ppm) {
  const s = CFG.settings, cat = catOf(CFG, b.cat), t = today(), nm = nowMin();
  const top = (b.start - s.dayStart) * ppm, h = Math.max(16, b.dur * ppm - 2);
  const lanesN = L ? L.lanes : 1, lane = L ? L.lane : 0, w = 100 / lanesN;
  const past = mode !== 'tpl' && (c.date < t || (c.date === t && b.start + b.dur <= nm));
  const needs = past && b.status === 'planned' && !c.virtual && b.cat !== 'sleep';
  const twice = c.twice && b.pillar && c.twice.has(b.title) && b.status === 'planned';
  const locked = b.pillar && mode !== 'tpl';
  const doneLock = mode !== 'tpl' && isMarked(b) && !UNLOCKED.has(b.id);
  const cls = ['blk', 'st-' + (b.status || 'planned'), needs ? 'needs' : '', twice ? 'twice' : '', locked ? 'locked' : '', doneLock ? 'done-lock' : '', mode !== 'tpl' && isMarked(b) && !doneLock ? 'unlocked' : ''].join(' ');
  let inner = '<div class="b-t">' + (b.status === 'done' ? '<span class="ok">✓</span>' : '') + (b.mit ? '<span title="MIT">★</span>' : '') + (locked ? ic('lock', 's-ic') : '') + '<span>' + esc(b.title) + '</span>' + (needs ? '<span class="q" title="How did it go?">?</span>' : '') + '</div>';
  if (h >= 30) inner += '<div class="b-m">' + hm(b.start) + '–' + hm(b.start + b.dur) + ' · ' + durTxt(b.dur) + (b.pillar && b.backup != null && !b.strict ? ' · backup ' + hm(b.backup) : '') + '</div>';
  const att = X.attachObjs(b.attach);
  if (att.length && h >= 50 && mode !== 'week') inner += '<div class="b-a">' + att.map((a, ai) => '<label class="b-chk"><input type="checkbox" data-ai="' + ai + '"' + (a.done ? ' checked' : '') + (mode === 'tpl' || doneLock ? ' disabled' : '') + '>' + esc(a.t) + '</label>').join('') + '</div>';
  if (b.checks && mode !== 'week') for (let m = Math.ceil((b.start + 1) / 30) * 30; m < b.start + b.dur; m += 30) inner += '<i class="tick" style="top:' + ((m - b.start) * ppm) + 'px" title="check ' + hm(m) + '"></i>';
  if (!locked && !doneLock && c.editable) inner += '<div class="b-rz" title="Drag to resize"></div>';
  if (mode !== 'tpl' && isMarked(b)) inner += doneLock ? '<button type="button" class="b-unlock" title="Unlock to change" aria-label="Unlock to change">' + ic('lock') + '</button>' : '<span class="b-unlock on" title="Unlocked for one change">' + ic('unlock') + '</span>';
  return '<div class="' + cls + '" data-id="' + b.id + '" style="--c:' + cat.color + ';top:' + top + 'px;height:' + h + 'px;left:calc(' + (lane * w) + '% + 3px);width:calc(' + w + '% - 6px)" title="' + esc(b.title) + ' ' + hm(b.start) + '–' + hm(b.start + b.dur) + '">' + inner + '</div>';
}
function gridHtml(cols, mode, ppm) {
  const s = CFG.settings, H = (s.dayEnd - s.dayStart) * ppm, t = today(), nm = nowMin();
  const hours = []; for (let h = Math.ceil(s.dayStart / 60); h * 60 <= s.dayEnd; h++) hours.push(h);
  const head = cols.length > 1 ? '<div class="g-corner"></div>' + cols.map((c, i) => '<div class="g-ch ' + (c.date === t ? 'is-today' : '') + '" data-ci="' + i + '">' + esc(c.label) + (c.sub ? '<small>' + c.sub + '</small>' : '') + '</div>').join('') : '';
  const times = '<div class="g-times" style="height:' + H + 'px">' + hours.map(h => '<span style="top:' + ((h * 60 - s.dayStart) * ppm) + 'px">' + pad(h) + ':00</span>').join('') + '</div>';
  const body = cols.map((c, i) => {
    const L = X.lanes(c.blocks);
    let html = c.blocks.map(b => blockHtml(b, L[b.id], c, mode, ppm)).join('');
    if (mode === 'day' && c.showGaps) {
      const from = c.date === t ? Math.max(s.dayStart, Math.ceil(nm / 15) * 15) : s.dayStart;
      X.gaps(c.blocks, from, s.bedtime, 30).forEach(g => { html += '<div class="gap" style="top:' + ((g.start - s.dayStart) * ppm + 2) + 'px;height:' + ((g.end - g.start) * ppm - 4) + 'px">Free ' + durTxt(g.end - g.start) + '</div>'; });
    }
    if (c.date === t && nm >= s.dayStart && nm <= s.dayEnd) html += '<div class="nowline" style="top:' + ((nm - s.dayStart) * ppm) + 'px"></div>';
    return '<div class="g-col ' + (c.past ? 'past ' : '') + (c.virtual ? 'virtual' : '') + '" data-ci="' + i + '" style="height:' + H + 'px">' + html + '</div>';
  }).join('');
  return '<div class="grid ' + mode + '" style="--cols:' + cols.length + ';--hpx:' + (60 * ppm) + 'px;--off:' + (-(s.dayStart % 60) * ppm) + 'px">' + head + times + body + '</div>';
}
function bindGrid(host, cols, mode, ppm, h) {
  const s = CFG.settings;
  const colEls = $$('.g-col', host);
  const minAt = (el, y) => s.dayStart + (y - el.getBoundingClientRect().top) / ppm;
  const colAt = x => { for (let i = 0; i < colEls.length; i++) { const r = colEls[i].getBoundingClientRect(); if (x >= r.left && x < r.right) return i; } return null; };
  const clampStart = m => clamp(m, s.dayStart, s.dayEnd - 15);
  host.onclick = e => {
    const hd = e.target.closest('.g-ch'); if (hd && h.onHead) return h.onHead(cols[+hd.dataset.ci]);
    const gp = e.target.closest('.gap'); if (gp) return h.onGap(cols[+gp.closest('.g-col').dataset.ci], +gp.dataset.gs, +gp.dataset.ge);
  };
  host.onchange = e => {
    const inp = e.target.closest('.b-chk input'); if (!inp) return;
    const bl = inp.closest('.blk'), c = cols[+bl.closest('.g-col').dataset.ci];
    const b = c.blocks.find(x => x.id === bl.dataset.id);
    h.onAttach && h.onAttach(c, b, +inp.dataset.ai, inp.checked);
  };
  host.onpointerdown = e => {
    if (e.button > 0) return;
    const ul = e.target.closest('button.b-unlock');
    if (ul) { e.preventDefault(); e.stopPropagation(); UNLOCKED.add(ul.closest('.blk').dataset.id); render(); toast('Unlocked for one change. Tap the block to edit or drag it.'); return; }
    if (e.target.closest('.blk.done-lock')) return;
    if (e.target.closest('.b-chk,.gap,.g-ch')) return;
    const colEl = e.target.closest('.g-col'); if (!colEl) return;
    const ci = +colEl.dataset.ci, c = cols[ci];
    const bl = e.target.closest('.blk');
    if (bl) {
      const b = c.blocks.find(x => x.id === bl.dataset.id);
      dragBlock(e, { c, ci, b, el: bl, kind: e.target.closest('.b-rz') ? 'resize' : 'move', canDrag: c.editable && !(b.pillar && mode !== 'tpl') });
      return;
    }
    if (c.editable) createDrag(e, c, colEl);
  };
  function dragBlock(e, st) {
    const touch = e.pointerType === 'touch';
    let armed = st.canDrag && (!touch || st.kind === 'resize'), moved = false, lp = null, toCi = st.ci;
    const x0 = e.clientX, y0 = e.clientY; let start = st.b.start, dur = st.b.dur;
    if (st.canDrag && touch && !armed) lp = setTimeout(() => { armed = true; st.el.classList.add('lifting'); try { navigator.vibrate && navigator.vibrate(12); } catch (_) {} }, 260);
    if (!touch && st.canDrag) e.preventDefault();
    const tm = ev => { if (armed) ev.preventDefault(); };
    const mv = ev => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!armed) { if (Math.hypot(dx, dy) > 8) { clearTimeout(lp); lp = null; } return; }
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true; DRAGGING = true; st.el.classList.add('dragging');
      const dm = Math.round(dy / ppm / 15) * 15;
      if (st.kind === 'resize') { dur = clamp(st.b.dur + dm, 15, s.dayEnd - st.b.start); st.el.style.height = (dur * ppm - 2) + 'px'; }
      else {
        start = clamp(st.b.start + dm, s.dayStart, s.dayEnd - st.b.dur);
        st.el.style.top = ((start - s.dayStart) * ppm) + 'px';
        if (cols.length > 1) { const k = colAt(ev.clientX); if (k != null && k !== toCi && cols[k].editable) { toCi = k; colEls[k].appendChild(st.el); st.el.style.left = '3px'; st.el.style.width = 'calc(100% - 6px)'; } }
      }
      st.el.classList.toggle('clash', !!X.clashWith(cols[toCi].blocks, { start, dur }, st.b.id));
      const m = st.el.querySelector('.b-m'); if (m) m.textContent = hm(start) + '–' + hm(start + dur) + ' · ' + durTxt(dur);
    };
    const cleanup = () => {
      clearTimeout(lp);
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel);
      document.removeEventListener('touchmove', tm);
      st.el.classList.remove('lifting', 'dragging');
      setTimeout(() => { DRAGGING = false; }, 0);
    };
    const up = () => { cleanup(); if (moved) h.onCommit({ c: st.c, b: st.b, to: cols[toCi], start, dur, kind: st.kind }); else h.onOpen(st.c, st.b); };
    const cancel = () => { cleanup(); if (moved) render(); };
    document.addEventListener('touchmove', tm, { passive: false });
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', cancel);
  }
  function createDrag(e, c, colEl) {
    const touch = e.pointerType === 'touch', x0 = e.clientX, y0 = e.clientY;
    const m0 = clampStart(Math.floor(minAt(colEl, y0) / 15) * 15);
    if (touch) {
      const up = ev => { off(); if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) h.onNew(c, m0, 30); };
      const off = () => { removeEventListener('pointerup', up); removeEventListener('pointercancel', off); };
      addEventListener('pointerup', up); addEventListener('pointercancel', off);
      return;
    }
    e.preventDefault();
    let ghost = null, end = m0 + 30, moved = false;
    const mv = ev => {
      if (!moved && Math.abs(ev.clientY - y0) < 5) return;
      moved = true;
      end = clamp(Math.round(minAt(colEl, ev.clientY) / 15) * 15, m0 + 15, s.dayEnd);
      if (!ghost) { ghost = document.createElement('div'); ghost.className = 'g-ghost'; colEl.appendChild(ghost); }
      ghost.style.top = ((m0 - s.dayStart) * ppm) + 'px'; ghost.style.height = ((end - m0) * ppm) + 'px'; ghost.textContent = hm(m0) + '–' + hm(end);
    };
    const up = () => { off(); if (ghost) ghost.remove(); h.onNew(c, m0, moved ? end - m0 : 30); };
    const off = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
}
const sortBlocks = d => d.blocks.sort((a, b) => a.start - b.start);
const clashTxt = c => c.title + ' ' + hm(c.start) + '–' + hm(c.start + c.dur);
function fitDur(blocks, start, dur) { const nxt = blocks.filter(X.live).filter(b => b.start >= start).reduce((m, b) => Math.min(m, b.start), 1440); return Math.max(5, Math.min(dur, nxt - start)); }
const dayHandlers = {
  onCommit({ c, b, to, start, dur }) {
    UNLOCKED.clear();
    const from = c.day, dest = to.day;
    const fb = from.blocks.find(x => x.id === b.id); if (!fb) return render();
    const cl = X.live(fb) ? X.clashWith(dest.blocks, { start, dur }, fb.id) : null;
    if (cl) { render(); return toast('Overlaps ' + clashTxt(cl) + '. Pick a free slot.'); }
    fb.start = start; fb.dur = dur;
    if (dest !== from) { from.blocks = from.blocks.filter(x => x !== fb); dest.blocks.push(fb); sortBlocks(dest); saveDay(from); saveDay(dest); toast('Moved to ' + fmtShort(dest.date) + ' ' + hm(start)); }
    else { sortBlocks(from); saveDay(from); }
    render();
  },
  onOpen(c, b) { openBlock(c.day, b); },
  onNew(c, start, dur) { openBlock(c.day, null, { start, dur: fitDur(c.blocks, start, dur) }); },
  onGap(c, gs, ge) { openWhatNow(c.day.date, { start: gs, end: ge }); },
  onAttach(c, b, ai, checked) { const d = c.day, x = d.blocks.find(y => y.id === b.id); x.attach = X.attachObjs(x.attach); x.attach[ai].done = checked; saveDay(d); },
  onHead(c) { CUR = c.date; setView('today'); },
};

/* ---------- block editor ---------- */
const DURS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180, 240, 300];
function catOptions(sel) { return CFG.cats.map(c => '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(c.name) + '</option>').join(''); }
function titleList() {
  const s = new Set();
  CFG.items.forEach(i => s.add(i.title)); CFG.rules.forEach(r => s.add(r.title)); CFG.templates.forEach(t => t.blocks.forEach(b => s.add(b.title)));
  if (TF) X.tfGoals(CFG, TF).forEach(g => s.add(g.name));
  return Array.from(s).map(t => '<option value="' + esc(t) + '">').join('');
}
function openBlock(d, b, preset) {
  const isNew = !b;
  const src = b || { title: '', cat: 'goal', start: preset.start, dur: preset.dur, attach: [], mit: false, pillar: false, backup: null, checks: false, status: 'planned' };
  const t = today();
  const lateNew = isNew && d && (d.date < t || (d.date === t && preset.start + preset.dur <= nowMin()));
  const durs = DURS.includes(src.dur) ? DURS : DURS.concat([src.dur]).sort((a, c) => a - c);
  const item = b && b.itemId ? CFG.items.find(i => i.id === b.itemId) : null;
  const bkAt = d && b && b.pillar && b.backup != null && !b.strict ? X.backupSlot(d, b, d.date === t ? nowMin() : 0) : null;
  const canBackup = bkAt != null && b.status !== 'moved' && !d.blocks.some(x => x.of === b.id);
  const html = '<div class="sh-h"><h2>' + (isNew ? 'New block' : 'Edit block') + '</h2><span class="muted small">' + fmtShort(d.date) + '</span><button class="iconbtn" data-x aria-label="Close">×</button></div>'
    + '<div class="form">'
    + (b && b.src === 'rule' ? '<div class="hint">Repeats from your routine. Changes here change this day only.</div>' : '')
    + (b && b.pillar && d ? '<div class="hint">Pillar: locked on the grid so it does not move by accident.' + (b.strict ? ' Strict: no backup, a miss stays one miss.' : '') + '</div>' : '')
    + '<label class="field"><span>Title</span><input id="bTitle" type="text" list="bTitles" value="' + esc(src.title) + '" placeholder="What will you do?" autocomplete="off"></label><datalist id="bTitles">' + titleList() + '</datalist>'
    + '<div class="grid3"><label class="field"><span>Category</span><select id="bCat">' + catOptions(src.cat) + '</select></label>'
    + '<label class="field"><span>Start</span><input id="bStart" type="time" step="300" value="' + hm(src.start) + '"></label>'
    + '<label class="field"><span>Length</span><select id="bDur">' + durs.map(x => '<option value="' + x + '"' + (x === src.dur ? ' selected' : '') + '>' + durTxt(x) + '</option>').join('') + '</select></label></div>'
    + '<div class="row"><label class="check"><input id="bMit" type="checkbox"' + (src.mit ? ' checked' : '') + '> MIT (most important)</label>'
    + '<label class="check"><input id="bPillar" type="checkbox"' + (src.pillar ? ' checked' : '') + '> Pillar</label>'
    + '<label class="check"><input id="bChecks" type="checkbox"' + (src.checks ? ' checked' : '') + '> Checks at :00/:30</label></div>'
    + '<div class="grid2" id="bPillarRow"' + (src.pillar ? '' : ' hidden') + '><label class="field"><span>Backup slot, same day</span><input id="bBackup" type="time" step="300" value="' + (src.backup != null ? hm(src.backup) : '') + '"></label>'
    + '<label class="check" style="align-self:end;padding-bottom:8px"><input id="bStrict" type="checkbox"' + (src.strict ? ' checked' : '') + '> Strict, no backup</label></div>'
    + '<label class="field"><span>Small things attached (comma separated)</span><input id="bAttach" type="text" value="' + esc(X.attachObjs(src.attach).map(a => a.t).join(', ')) + '" placeholder="e.g. 10 min walk, stretch"></label>'
    + (d ? '<label class="field"><span>Note</span><input id="bNote" type="text" value="' + esc(src.note || '') + '"></label>' : '')
    + (d && !isNew ? '<div class="field"><span>How did it go?</span><div class="stbtns">' + ['done', 'skipped'].map(s => '<button type="button" data-st="' + s + '" class="' + (b.status === s ? 'on' : '') + '">' + { done: 'Done', skipped: 'Skipped' }[s] + '</button>').join('') + '</div></div>' : '')
    + (canBackup ? '<button type="button" class="btn" data-backup>Use backup at ' + hm(bkAt) + '</button>' : '')
    + (item && item.kind === 'dream' ? '<label class="check"><input id="bDream" type="checkbox"' + (item.done ? ' checked' : '') + '> Dream done, tick it off in the bank</label>' : '')
    + (isNew && d ? '<label class="check"><input id="bUnpl" type="checkbox"' + (lateNew ? ' checked' : '') + '> Unplanned (this is what really happened)</label>' : '')
    + '<div class="al alert" id="bErr" hidden></div>'
    + '</div><div class="sh-f">' + (!isNew ? (b.src === 'rule' && b.ruleId ? '<button class="btn danger l" data-del>Remove this day only</button><button class="btn danger" data-stop>Stop repeating</button>' : '<button class="btn danger l" data-del>Delete</button>') : '') + '<button class="btn" data-x>Cancel</button><button class="btn pri" data-save>Save</button></div>';
  openSheet(html, sh => {
    let status = b ? b.status : 'planned';
    $('#bPillar', sh).onchange = e => { $('#bPillarRow', sh).hidden = !e.target.checked; };
    $$('[data-st]', sh).forEach(btn => { btn.onclick = () => { status = status === btn.dataset.st ? 'planned' : btn.dataset.st; $$('[data-st]', sh).forEach(x => x.classList.toggle('on', x.dataset.st === status)); }; });
    const bk = $('[data-backup]', sh);
    if (bk) bk.onclick = () => { const at = bkAt; X.useBackup(d, b.id, at); saveDay(d); closeSheet(); render(); toast(b.title + ' moved to backup ' + hm(at)); };
    const stop = $('[data-stop]', sh);
    if (stop) stop.onclick = () => {
      const cfgBefore = clone(CFG), before = clone(d);
      X.endRule(CFG, b.ruleId, d.date); saveCfg();
      d.blocks = d.blocks.filter(x => x.id !== b.id); saveDay(d);
      closeSheet(); render();
      toast(b.title + ' stops repeating from ' + fmtShort(d.date) + '. Earlier days keep it.', 'Undo', () => { CFG = X.mergeConfig(cfgBefore); saveCfg(); saveDay(before); render(); }, 8000);
    };
    const del = $('[data-del]', sh);
    if (del) del.onclick = () => {
      const before = clone(d); d.blocks = d.blocks.filter(x => x.id !== b.id); saveDay(d);
      toast('Removed ' + b.title + (b.src === 'rule' ? ' from this day. It still repeats.' : ''), 'Undo', () => { saveDay(before); render(); });
      closeSheet(); render();
    };
    const save = () => {
      const title = $('#bTitle', sh).value.trim();
      if (!title) { $('#bTitle', sh).focus(); return; }
      const start = toMin($('#bStart', sh).value), dur = +$('#bDur', sh).value;
      const pillar = $('#bPillar', sh).checked, strict = pillar && $('#bStrict', sh).checked;
      const bv = $('#bBackup', sh).value;
      const names = $('#bAttach', sh).value.split(',').map(x => x.trim()).filter(Boolean);
      const oldAtt = X.attachObjs(src.attach);
      const vals = { title, cat: $('#bCat', sh).value, start: clamp(start, 0, 1439), dur, mit: $('#bMit', sh).checked, pillar, strict, checks: $('#bChecks', sh).checked, backup: pillar && !strict && bv ? toMin(bv) : null };
      const willLive = isNew ? true : status !== 'skipped' && status !== 'moved';
      const cl = willLive ? X.clashWith(d.blocks, { start: vals.start, dur }, b ? b.id : null) : null;
      if (cl) { const er = $('#bErr', sh); er.hidden = false; er.textContent = 'Overlaps ' + clashTxt(cl) + '. Change the start or the length.'; return; }
      vals.attach = names.map(n => ({ t: n, done: !!(oldAtt.find(a => a.t === n) || {}).done }));
      vals.note = $('#bNote', sh).value.trim();
      if (isNew) { const unpl = $('#bUnpl', sh).checked; d.blocks.push(Object.assign({ id: uid(), src: 'manual', status: unpl ? 'done' : 'planned', unplanned: unpl }, vals)); }
      else Object.assign(d.blocks.find(x => x.id === b.id), vals, { status });
      sortBlocks(d);
      saveDay(d);
      const dr = $('#bDream', sh);
      if (dr && item) { item.done = dr.checked; item.doneAt = dr.checked ? d.date : null; saveCfg(); }
      closeSheet(); render();
    };
    $('[data-save]', sh).onclick = save;
    sh.onkeydown = e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') { e.preventDefault(); save(); } };
  });
}

/* ---------- What now? ---------- */
function currentBlock(d, nm) { return d.blocks.filter(X.live).find(b => b.start <= nm && b.start + b.dur > nm); }
function firstGap(d, date) {
  const t = today(), s = CFG.settings, nm = nowMin();
  const from = date === t ? Math.max(s.dayStart, Math.ceil(nm / 5) * 5) : s.dayStart;
  const cur = date === t ? currentBlock(d, nm) : null;
  const gs = X.gaps(d.blocks, from, s.bedtime, 10);
  if (!cur) { const g = gs.find(x => x.start <= from + 5); if (g) return g; }
  return gs[0] || null;
}
function boredCat(t) { return /walk|stretch|balayam|yoga|move|exercise/i.test(t) ? 'health' : /study|page|read/i.test(t) ? 'goal' : /call|friend|family|kid/i.test(t) ? 'family' : 'self'; }
function openWhatNow(date, gap) {
  const t = today(), nm = nowMin(); date = date || t;
  const d = day(date);
  if (!gap) gap = firstGap(d, date);
  const cur = date === t ? currentBlock(d, nm) : null;
  const offers = date === t ? X.backupOffers(d, nm) : [];
  const sugs = gap ? X.suggest(CFG, STORE, TF, date, gap, t, 3) : [];
  const canStartNow = gap && date === t && gap.start <= nm + 5;
  let html = '<div class="sh-h"><h2>What now?</h2><span class="muted small">' + fmtShort(date) + '</span><button class="iconbtn" data-x aria-label="Close">×</button></div>';
  if (cur) html += '<div class="hint">You are in <b>' + esc(cur.title) + '</b> until ' + hm(cur.start + cur.dur) + '. The bell ends it, not you.' + (gap ? ' Your next free slot:' : '') + '</div>';
  if (gap) html += '<div class="row" style="margin-bottom:10px"><span class="chip">Free ' + hm(gap.start) + '–' + hm(gap.end) + '</span><span class="chip">' + durTxt(gap.end - gap.start) + '</span><span class="chip">' + zoneOf(gap.start) + '</span></div>';
  offers.forEach((o, i) => {
    html += '<div class="sug backup" style="--c:' + catOf(CFG, o.block.cat).color + '"><div class="sw"></div><div><div class="t">Backup: ' + esc(o.block.title) + '</div><div class="w">You missed it at ' + hm(o.block.start) + '. One miss is fine, do not miss twice.</div></div><div class="a"><button class="btn pri sm" data-off="' + i + '">Use backup ' + hm(o.at) + '</button></div></div>';
  });
  if (!gap && !offers.length) html += '<div class="empty">No free time left' + (date === t ? ' today' : '') + '. Protect your bedtime.</div>';
  sugs.forEach((sg, i) => {
    const c = catOf(CFG, sg.item.cat);
    html += '<div class="sug" style="--c:' + c.color + '"><div class="sw"></div><div><div class="t">' + esc(sg.item.title) + '</div><div class="w">' + esc(c.name) + ' · ' + durTxt(sg.min) + ' · ' + esc(sg.why) + '</div></div><div class="a">'
      + (canStartNow ? '<button class="btn pri sm" data-go="' + i + '" data-now="1">Start now</button>' : '') + '<button class="btn sm" data-go="' + i + '">Put at ' + hm(gap.start) + '</button></div></div>';
  });
  if (gap && !sugs.length) html += '<div class="empty">Nothing in the bank fits ' + durTxt(gap.end - gap.start) + '. Add a few dreams in Bank.</div>';
  html += '<div class="lbl" style="margin:14px 0 8px">Bored? Pick one, not the phone</div><div class="row">' + CFG.boredom.map((x, i) => '<button class="btn sm" data-bo="' + i + '">' + esc(x) + '</button>').join('') + '</div>';
  openSheet(html, sh => {
    $$('[data-off]', sh).forEach(bt => { bt.onclick = () => { const o = offers[+bt.dataset.off]; const dd = DAYS[date] || d; X.useBackup(dd, o.block.id, o.at); saveDay(dd); closeSheet(); render(); toast(o.block.title + ' at ' + hm(o.at)); }; });
    $$('[data-go]', sh).forEach(bt => {
      bt.onclick = () => {
        const sg = sugs[+bt.dataset.go];
        const start = bt.dataset.now ? Math.max(gap.start, Math.floor(nm / 5) * 5) : gap.start;
        const dur = Math.max(10, Math.min(sg.min, gap.end - start));
        const dd = DAYS[date] || d;
        dd.blocks.push({ id: uid(), start, dur, title: sg.item.title, cat: sg.item.cat, itemId: sg.item.id, src: 'bank', status: 'planned', attach: [], pillar: false, mit: false });
        sortBlocks(dd); saveDay(dd); closeSheet(); render();
        toast((bt.dataset.now ? 'Started: ' : 'Planned: ') + sg.item.title + ' until ' + hm(start + dur));
      };
    });
    $$('[data-bo]', sh).forEach(bt => {
      bt.onclick = () => {
        const title = CFG.boredom[+bt.dataset.bo];
        const mm = /(\d+)\s*min/i.exec(title); const dur = mm ? Math.max(5, +mm[1]) : 15;
        const dd = DAYS[t] || day(t);
        const nb = X.placeBlock(CFG, dd, { title, min: dur, cat: boredCat(title), src: 'bank' }, Math.floor(nowMin() / 5) * 5);
        if (!nb) return toast('No free ' + durTxt(dur) + ' left today.');
        saveDay(dd); closeSheet(); render(); toast('Go: ' + title + ' at ' + hm(nb.start));
      };
    });
  });
}
function doFill(date) {
  const before = clone(day(date));
  const r = X.fillDay(CFG, STORE, TF, date, today(), nowMin());
  if (!r.added.length) return toast('No free gap of 30 min or more to fill.');
  saveDay(r.day); render();
  toast('Added ' + r.added.length + ' blocks from your bank. ' + Math.round(CFG.settings.buffer * 100) + '% stays free.', 'Undo', () => { saveDay(before); render(); }, 7000);
}

/* ---------- close-out ---------- */
function slipOn(date) { return !!(TF && (TF.sanyam || []).some(r => r.d === date && (!r.h || X.sanyamHabits(TF).some(h => h.id === r.h)))); }
function openClose(date) {
  const d = DAYS[date] || day(date);
  const rows = d.blocks.filter(b => b.cat !== 'sleep' && b.status !== 'moved');
  const close = d.close || {};
  const slip = slipOn(date);
  const html = '<div class="sh-h"><h2>Close the day</h2><span class="muted small">' + fmtShort(date) + '</span><button class="iconbtn" data-x aria-label="Close">×</button></div>'
    + '<div class="hint">Two minutes. Mark each block, add what really happened, write one line.</div>'
    + (rows.length ? rows.map(b => '<div class="closer" data-id="' + b.id + '"><div><b>' + esc(b.title) + '</b> <span class="muted mono small">' + hm(b.start) + '–' + hm(b.start + b.dur) + '</span></div><div class="mini">' + [['done', '✓ Done'], ['skipped', '✗ Skipped'], ['planned', '–']].map(([s, l]) => '<button type="button" data-s="' + s + '" class="' + (b.status === s ? 'on' : '') + '" title="' + s + '">' + l + '</button>').join('') + '</div></div>').join('') : '<div class="empty">No blocks this day.</div>')
    + '<div class="lbl" style="margin:16px 0 6px">Add what really happened</div>'
    + '<div class="grid3"><input id="uTitle" type="text" placeholder="e.g. Scrolled phone"><select id="uCat">' + catOptions('waster') + '</select><div class="row" style="flex-wrap:nowrap"><input id="uStart" type="time" step="300" value="' + hm(Math.floor(nowMin() / 15) * 15) + '"><select id="uDur">' + DURS.map(x => '<option value="' + x + '"' + (x === 30 ? ' selected' : '') + '>' + durTxt(x) + '</option>').join('') + '</select></div></div>'
    + '<div style="margin-top:6px"><button type="button" class="btn sm" data-addu>' + ic('plus') + 'Add</button></div>'
    + '<div class="form" style="margin-top:16px">'
    + '<label class="field"><span>One line: what made today different from yesterday?</span><input id="cLine" type="text" value="' + esc(close.line || '') + '"></label>'
    + '<label class="field"><span>' + (slip ? 'Sanyam slip is logged in Tenfold today. What happened just before? Which gap was it?' : 'If sanyam broke today: what happened just before? Which gap?') + '</span><textarea id="cSlip" placeholder="Time, place, what you were doing, what you felt">' + esc(d.slipNote || '') + '</textarea></label>'
    + '<label class="field"><span>Tomorrow\'s MIT (most important task)</span><input id="cMit" type="text" value="' + esc(close.mit || '') + '"></label>'
    + '</div><div class="sh-f"><button class="btn" data-x>Cancel</button><button class="btn pri" data-save>Close the day</button></div>';
  openSheet(html, sh => {
    $$('.closer', sh).forEach(r => { $$('[data-s]', r).forEach(bt => { bt.onclick = () => { d.blocks.find(b => b.id === r.dataset.id).status = bt.dataset.s; saveDay(d); $$('[data-s]', r).forEach(x => x.classList.toggle('on', x === bt)); }; }); });
    $('[data-addu]', sh).onclick = () => {
      const title = $('#uTitle', sh).value.trim(); if (!title) return $('#uTitle', sh).focus();
      const us = toMin($('#uStart', sh).value), ud = +$('#uDur', sh).value, ucl = X.clashWith(d.blocks, { start: us, dur: ud });
      if (ucl) return toast('Overlaps ' + clashTxt(ucl) + '. Mark that one skipped first, or change the time.', null, null, 7000);
      d.blocks.push({ id: uid(), start: us, dur: ud, title, cat: $('#uCat', sh).value, src: 'manual', status: 'done', unplanned: true, attach: [], pillar: false, mit: false });
      sortBlocks(d); saveDay(d); toast('Added: ' + title); openClose(date);
    };
    $('[data-save]', sh).onclick = () => {
      d.close = { line: $('#cLine', sh).value.trim(), mit: $('#cMit', sh).value.trim(), at: Date.now() };
      d.slipNote = $('#cSlip', sh).value.trim();
      saveDay(d);
      const nx = addDays(date, 1);
      if (d.close.mit && nx >= today()) {
        const nd = DAYS[nx] || day(nx);
        if (!nd.blocks.some(b => b.mit && norm(b.title) === norm(d.close.mit))) {
          const s = CFG.settings, g = X.gaps(nd.blocks, Math.max(s.dayStart, 540), 780, 30)[0] || X.gaps(nd.blocks, s.dayStart, s.bedtime, 30)[0];
          if (g) { nd.blocks.push({ id: uid(), start: g.start, dur: Math.min(60, g.end - g.start), title: d.close.mit, cat: 'goal', mit: true, src: 'manual', status: 'planned', attach: [], pillar: false }); sortBlocks(nd); saveDay(nd); }
        }
      }
      closeSheet(); render(); toast('Day closed. Sleep well.');
    };
  });
}

/* ---------- views ---------- */
function statusCounts(d) { const nm = nowMin(), t = today(); const past = d.blocks.filter(b => b.cat !== 'sleep' && (d.date < t || b.start + b.dur <= nm)); return { past: past.length, marked: past.filter(b => b.status !== 'planned').length }; }
function dayBar(d, nm) {
  const s = CFG.settings, span = Math.max(1, s.bedtime - s.dayStart);
  const pct = clamp(Math.round((nm - s.dayStart) / span * 100), 0, 100);
  return '<div class="bar day" title="Day ' + pct + '% gone"><i style="width:' + pct + '%"></i></div>';
}
function nowBarHtml(d, stats) {
  const nm = nowMin(), s = CFG.settings;
  const cur = currentBlock(d, nm);
  const next = d.blocks.filter(X.live).filter(b => b.start > nm).sort((a, b) => a.start - b.start)[0];
  let t, sub, blockBar = '';
  if (nm >= s.bedtime) { t = 'Past your bedtime'; sub = 'Lights out. Close the day if you have not.'; }
  else if (cur) {
    const left = cur.start + cur.dur - nm, pct = Math.round((nm - cur.start) / cur.dur * 100);
    t = '<span class="dot" style="--c:' + catOf(CFG, cur.cat).color + '"></span>' + esc(cur.title);
    sub = durTxt(left) + ' left · ends ' + hm(cur.start + cur.dur) + (cur.checks ? ' · next check ' + hm(Math.ceil((nm + 1) / 30) * 30) : '') + (next ? ' · then ' + esc(next.title) + ' ' + hm(next.start) : '');
    blockBar = '<div class="bar blk-bar" style="--c:' + catOf(CFG, cur.cat).color + '"><i style="width:' + pct + '%"></i></div>';
  } else {
    const until = next ? next.start : s.bedtime;
    t = 'Free now'; sub = durTxt(until - nm) + ' until ' + (next ? esc(next.title) + ' ' + hm(next.start) : 'bedtime ' + hm(s.bedtime));
  }
  const pct = clamp(Math.round((nm - s.dayStart) / Math.max(1, s.bedtime - s.dayStart) * 100), 0, 100);
  return '<div class="nowbar" id="nowbar"><div class="nb-main"><div class="now-t">' + t + '</div><div class="now-s">' + sub + '</div>' + blockBar + '</div>'
    + '<div class="nb-side"><div class="nb-stats">' + (stats || '') + '<span>day ' + pct + '%</span></div><button class="btn sm ghost" data-act="bored">Bored?</button></div>'
    + dayBar(d, nm) + '</div>';
}
function dismissed(date) { const o = load(LS_DISMISS) || {}; return o[date] || []; }
/* ---------- day calendar: one row per hour, time runs left to right (:00-:30 | :30-:60) ---------- */
let ROW_H = 44;
function dgRows() { const s = CFG.settings, r = []; for (let h = Math.floor(s.dayStart / 60); h < Math.ceil(s.dayEnd / 60); h++) r.push(h); return r; }
function segsOf(b) {
  const out = [], e = b.start + b.dur;
  for (let h = Math.floor(b.start / 60); h * 60 < e; h++) {
    const s0 = Math.max(b.start, h * 60), s1 = Math.min(e, (h + 1) * 60);
    if (s1 > s0) out.push({ h, l: (s0 - h * 60) / 60 * 100, w: (s1 - s0) / 60 * 100, first: s0 === b.start, last: s1 === e, min: s1 - s0 });
  }
  return out;
}
function segHtml(b, sg, main, c, extra) {
  const cat = catOf(CFG, b.cat), t = today(), nm = nowMin();
  const past = c.date < t || (c.date === t && b.start + b.dur <= nm);
  const needs = past && b.status === 'planned' && !c.virtual && b.cat !== 'sleep';
  const marked = isMarked(b), doneLock = marked && !UNLOCKED.has(b.id);
  const cls = ['ev', 'st-' + (b.status || 'planned'), sg.first ? 'first' : '', sg.last ? 'last' : '', b.pillar ? 'pillar' : '', doneLock ? 'done-lock' : '', extra || ''].join(' ');
  let inner = '';
  // every piece of a block that wraps across hours carries its name; the time sits on the main piece
  inner += '<span class="sg-t' + (sg.first ? '' : ' cont') + '">' + (sg.first ? '' : '↳ ') + (b.status === 'done' ? '<span class="ok">✓</span>' : '') + (b.pillar && sg.first ? ic('lock', 's-ic') : '') + (b.mit && sg.first ? '<span class="mit">★</span>' : '') + esc(b.title) + '</span>';
  if (main && sg.min >= 25) inner += '<span class="sg-m">' + hm(b.start) + '–' + hm(b.start + b.dur) + '</span>';
  if (needs && sg.last) inner += '<i class="sg-q" title="How did it go?"></i>';
  if (marked && sg.last) inner += doneLock ? '<button type="button" class="sg-unlock" title="Unlock to change" aria-label="Unlock to change">' + ic('lock') + '</button>' : '<span class="sg-unlock on" title="Unlocked for one change">' + ic('unlock') + '</span>';
  if (sg.last && !b.pillar && !doneLock && c.editable) inner += '<i class="sg-rz" title="Drag to change the length"></i>';
  return '<div class="' + cls + '" data-id="' + b.id + '" style="--c:' + cat.color + ';left:calc(' + sg.l + '% + 1px);width:calc(' + sg.w + '% - 2px)" title="' + esc(b.title) + ' ' + hm(b.start) + '–' + hm(b.start + b.dur) + '">' + inner + '</div>';
}
function blockSegs(b, c, extra) {
  const ss = segsOf(b); if (!ss.length) return [];
  const main = ss.reduce((m, x) => x.min > m.min ? x : m, ss[0]);
  return ss.map(sg => ({ h: sg.h, html: segHtml(b, sg, sg === main, c, extra) }));
}
function dayGridHtml(c) {
  const t = today(), nm = nowMin(), rows = dgRows(), by = {};
  rows.forEach(h => { by[h] = []; });
  c.blocks.forEach(b => blockSegs(b, c).forEach(x => { if (by[x.h]) by[x.h].push(x.html); }));
  const nowH = c.date === t ? Math.floor(nm / 60) : -1;
  return '<div class="dg" style="--rowh:' + ROW_H + 'px"><div class="dg-head"><span></span><div class="dg-scale"><span style="left:0">:00</span><span style="left:50%">:30</span></div></div>'
    + rows.map(h => '<div class="dg-row' + (h === nowH ? ' now' : '') + ((c.date < t || (c.date === t && (h + 1) * 60 <= nm)) ? ' past' : '') + '" data-h="' + h + '"><span class="dg-h">' + pad(h) + ':00</span><div class="dg-track">' + by[h].join('')
      + (h === nowH ? '<i class="dg-now" style="left:' + ((nm % 60) / 60 * 100) + '%"></i>' : '') + '</div></div>').join('') + '</div>';
}
function bindDayGrid(host, c, h) {
  const s = CFG.settings;
  const minuteAt = (x, y) => {
    for (const tr of $$('.dg-track', host)) {
      const r = tr.getBoundingClientRect();
      if (y >= r.top - 1 && y <= r.bottom + 1) return +tr.parentNode.dataset.h * 60 + clamp((x - r.left) / r.width, 0, 1) * 60;
    }
    return null;
  };
  host._minuteAt = minuteAt;
  host._ghost = (start, dur) => { segEls('_drop').forEach(x => x.remove()); if (start != null) paint({ id: '_drop', start, dur, title: '', cat: 'goal', status: 'planned' }, 'drop' + (X.clashWith(c.blocks, { start, dur }) ? ' clash' : '')); };
  const segEls = id => $$('.ev[data-id="' + id + '"]', host);
  const paint = (b, extra) => {
    segEls(b.id).forEach(x => x.remove());
    blockSegs(b, c, extra).forEach(x => { const tr = $('.dg-row[data-h="' + x.h + '"] .dg-track', host); if (tr) tr.insertAdjacentHTML('beforeend', x.html); });
  };
  host.onpointerdown = e => {
    if (e.button > 0) return;
    const ub = e.target.closest('button.sg-unlock');
    if (ub) { e.preventDefault(); UNLOCKED.add(ub.closest('.ev').dataset.id); render(); toast('Unlocked for one change.'); return; }
    const sg = e.target.closest('.ev');
    if (sg) {
      const b = c.blocks.find(x => x.id === sg.dataset.id);
      if (!b || sg.classList.contains('done-lock')) return;
      return dragSeg(e, b, !!e.target.closest('.sg-rz'));
    }
    if (e.target.closest('.dg-track') && c.editable) createDrag(e);
  };
  function dragSeg(e, b, rz) {
    const touch = e.pointerType === 'touch', canDrag = c.editable && !b.pillar;
    let armed = canDrag && (!touch || rz), moved = false, lp = null, start = b.start, dur = b.dur;
    const grab = (minuteAt(e.clientX, e.clientY) ?? b.start) - b.start;
    if (canDrag && touch && !armed) lp = setTimeout(() => { armed = true; segEls(b.id).forEach(x => x.classList.add('lifting')); try { navigator.vibrate && navigator.vibrate(12); } catch (_) {} }, 260);
    if (!touch && canDrag) e.preventDefault();
    const tm = ev => { if (armed) ev.preventDefault(); };
    const mv = ev => {
      const dx = ev.clientX - e.clientX, dy = ev.clientY - e.clientY;
      if (!armed) { if (Math.hypot(dx, dy) > 8) { clearTimeout(lp); lp = null; } return; }
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true; DRAGGING = true;
      const m = minuteAt(ev.clientX, ev.clientY); if (m == null) return;
      if (rz) dur = clamp(Math.round((m - b.start) / 15) * 15, 15, s.dayEnd - b.start);
      else start = clamp(Math.round((m - grab) / 15) * 15, s.dayStart, s.dayEnd - b.dur);
      const clash = X.clashWith(c.blocks, { start, dur }, b.id);
      paint(Object.assign({}, b, { start, dur }), 'dragging' + (clash ? ' clash' : ''));
    };
    const cleanup = () => {
      clearTimeout(lp);
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel);
      document.removeEventListener('touchmove', tm);
      setTimeout(() => { DRAGGING = false; }, 0);
    };
    const up = () => { cleanup(); if (moved) h.onCommit({ c, b, to: c, start, dur }); else h.onOpen(c, b); };
    const cancel = () => { cleanup(); if (moved) render(); };
    document.addEventListener('touchmove', tm, { passive: false });
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', cancel);
  }
  function createDrag(e) {
    const m0r = minuteAt(e.clientX, e.clientY); if (m0r == null) return;
    const m0 = clamp(Math.floor(m0r / 15) * 15, s.dayStart, s.dayEnd - 15);
    if (e.pointerType === 'touch') {
      const x0 = e.clientX, y0 = e.clientY;
      const up = ev => { off(); if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) h.onNew(c, m0, 30); };
      const off = () => { removeEventListener('pointerup', up); removeEventListener('pointercancel', off); };
      addEventListener('pointerup', up); addEventListener('pointercancel', off);
      return;
    }
    e.preventDefault();
    let end = m0 + 30, moved = false;
    const ghost = { id: '_ghost', start: m0, dur: 30, title: 'New', cat: 'goal', status: 'planned' };
    const mv = ev => {
      const m = minuteAt(ev.clientX, ev.clientY); if (m == null) return;
      const nend = clamp(Math.ceil(m / 15) * 15, m0 + 15, s.dayEnd);
      if (!moved && nend === m0 + 15 && Math.abs(ev.clientX - e.clientX) < 5) return;
      moved = true; end = nend; ghost.dur = end - m0; ghost.title = hm(m0) + '–' + hm(end);
      paint(ghost, 'ghost');
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); segEls('_ghost').forEach(x => x.remove()); h.onNew(c, m0, moved ? end - m0 : 30); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
}

const blockOf = (d, x) => x.placed ? d.blocks.find(b => b.id === x.placed) : null;
let SUGS = [];
const FIT_MAX = 5;  // your tasks + Saarthi suggestions, never more than 5 a day
function fitFrom(d) { const s = CFG.settings, t = today(); return d.date === t ? Math.max(s.dayStart, Math.ceil(nowMin() / 15) * 15) : s.dayStart; }
const durChip = m => Math.floor(m / 60) + ':' + pad(m % 60);
function taskCard(o) {
  // o: {cls, drag, label, c, title, meta, dur, chk, right}
  return '<div class="tcard ' + (o.cls || '') + (o.drag ? ' drag' : '') + '" style="--c:' + o.c.color + '"' + (o.drag ? ' data-drag="' + o.drag + '" data-label="' + esc(o.label) + '"' : '') + '>'
    + (o.chk || '<span class="tc-dot"></span>')
    + '<div class="tc-main"><div class="tc-t">' + esc(o.title) + '</div><div class="tc-meta"><span class="tag">#' + esc(o.c.name.toLowerCase()) + '</span>' + (o.meta || '') + '</div></div>'
    + (o.dur ? '<span class="tc-dur">' + durChip(o.dur) + '</span>' : '<span></span>') + (o.right || '') + '</div>';
}
function fitHtml(d) {
  const t = today(), s = CFG.settings;
  if (d.date < t || d.untracked) return '';
  const from = fitFrom(d);
  const gs = X.gaps(d.blocks, from, s.bedtime, 15);
  const freeMin = gs.reduce((a, g) => a + g.end - g.start, 0);
  const todos = d.todo || [];
  const open = todos.filter(x => !x.done && !blockOf(d, x));
  const needMin = open.reduce((a, x) => a + (x.min || 30), 0);
  let h = '<div class="fitbox"><div class="fb-h"><div><h3>To fit ' + (d.date === t ? 'today' : fmtShort(d.date)) + '</h3><span class="fb-sub">' + Math.min(FIT_MAX, todos.length) + ' of ' + FIT_MAX + ' · ' + durTxt(freeMin) + ' free</span></div></div>';
  if (needMin > freeMin * (1 - s.buffer) && open.length) h += '<div class="fb-warn">' + durTxt(needMin) + ' to fit, only ' + durTxt(freeMin) + ' free. Keep what matters.</div>';
  h += todos.map(x => {
    const b = blockOf(d, x), done = x.done || (b && b.status === 'done'), c = catOf(CFG, x.cat);
    return taskCard({ cls: done ? 'done' : b ? 'placed' : '', drag: b || done ? '' : 'todo:' + x.id, label: x.title, c, title: x.title, dur: x.min || 30,
      chk: '<button type="button" class="tc-chk" data-act="fitdone" data-id="' + x.id + '" aria-label="Mark done">' + (done ? ic('check') : '') + '</button>',
      meta: (b ? '<span>' + hm(b.start) + '</span>' : '') + (x.by === 'saarthi' ? '<span>Saarthi</span>' : ''),
      right: '<button type="button" class="tc-x" data-act="fitdel" data-id="' + x.id + '" aria-label="Remove">×</button>' });
  }).join('');
  if (todos.length >= FIT_MAX) h += '<div class="fb-note">' + FIT_MAX + ' for today. Tick one done or remove one to add another.</div>';
  else h += '<div class="tc-add"><span class="tc-plus">' + ic('plus') + '</span><input id="fitTitle" type="text" placeholder="Add a task" autocomplete="off" list="bTitles"><datalist id="bTitles">' + titleList() + '</datalist>'
    + '<select id="fitMin" aria-label="Length">' + [15, 20, 30, 45, 60, 90, 120, 180].map(m => '<option value="' + m + '"' + (m === 30 ? ' selected' : '') + '>' + durChip(m) + '</option>').join('') + '</select>'
    + '<select id="fitCat" aria-label="Category">' + catOptions('office') + '</select><button type="button" class="btn sm pri" data-act="fitadd">Add</button></div>';
  const ops = (INBOX && INBOX.ops || []).map((o, i) => ({ o, i })).filter(({ o }) => (o.state === 'pending' || o.state === 'failed') && o.op && (o.op.date === d.date || (!o.op.date && d.date === t)));
  const big = gs.filter(g => g.end - g.start >= 30).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  const hide = d.sugHide || [];
  const slots = Math.max(0, FIT_MAX - todos.length);
  const opsShown = ops.slice(0, slots);
  const titles = new Set(todos.map(x => norm(x.title)));
  SUGS = big && slots > opsShown.length ? X.suggest(CFG, STORE, TF, d.date, big, t, 8).filter(x => !hide.includes(x.item.id) && !titles.has(norm(x.item.title))).slice(0, slots - opsShown.length).map(x => Object.assign(x, { gap: big })) : [];
  if (opsShown.length || SUGS.length) {
    h += '<div class="fb-sec">' + ic('saarthi', 's-ic') + 'Saarthi suggests</div>';
    h += opsShown.map(({ o, i }) => { const isB = o.op.type === 'addBlock'; const c = catOf(CFG, isB ? o.op.block.cat : 'goal');
      return taskCard({ cls: 'sug', drag: isB ? 'op:' + i : '', label: isB ? o.op.block.title : o.label, c, title: isB ? o.op.block.title : o.label, dur: isB ? o.op.block.dur || 30 : 0,
        meta: o.why ? '<span class="why">' + esc(o.why) + '</span>' : '',
        right: '<button type="button" class="btn sm" data-act="opfit" data-i="' + i + '">Accept</button><button type="button" class="tc-x" data-act="oprej" data-i="' + i + '" aria-label="Reject">×</button>' }); }).join('');
    h += SUGS.map((sg, i) => taskCard({ cls: 'sug', drag: 'sug:' + i, label: sg.item.title, c: catOf(CFG, sg.item.cat), title: sg.item.title, dur: sg.min,
      meta: '<span class="why">' + esc(sg.why) + '</span>',
      right: '<button type="button" class="btn sm" data-act="sugacc" data-i="' + i + '">Accept</button><button type="button" class="tc-x" data-act="sughide" data-id="' + esc(sg.item.id) + '" aria-label="Not today">×</button>' })).join('');
  }
  if (todos.some(x => !x.done && !blockOf(d, x)) || SUGS.length || opsShown.length) h += '<div class="fb-note">Drag a card onto the calendar to give it a time.</div>';
  return h + '</div>';
}
function fitAdd() {
  const d = AG_DAY; const inp = $('#fitTitle'); if (!d || !inp) return;
  const title = inp.value.trim(); if (!title) return inp.focus();
  if ((d.todo || []).length >= FIT_MAX) return toast(FIT_MAX + ' is the limit for a day.');
  d.todo = (d.todo || []).concat({ id: uid(), title, min: +$('#fitMin').value, cat: $('#fitCat').value, done: false });
  saveDay(d); render();
  const n = $('#fitTitle'); if (n) n.focus();
}
function fitItem(key) {
  const d = AG_DAY; if (!d) return null;
  const [kind, ref] = key.split(':');
  if (kind === 'todo') { const x = (d.todo || []).find(y => y.id === ref); return x && { kind, x, title: x.title, min: x.min || 30, cat: x.cat }; }
  if (kind === 'sug') { const sg = SUGS[+ref]; return sg && { kind, sg, title: sg.item.title, min: sg.min, cat: sg.item.cat, itemId: sg.item.id }; }
  if (kind === 'op') { const o = INBOX && INBOX.ops[+ref]; return o && o.op.type === 'addBlock' && { kind, o, title: o.op.block.title, min: o.op.block.dur || 30, cat: o.op.block.cat || 'goal', at: o.op.block.start }; }
  return null;
}
function openPlace(key, start) {
  const d = AG_DAY, it = fitItem(key), s = CFG.settings; if (!d || !it) return;
  if (start == null) start = it.at != null ? it.at : ((X.gaps(d.blocks, fitFrom(d), s.bedtime, it.min)[0] || {}).start);
  if (start == null) start = fitFrom(d);
  const durs = DURS.includes(it.min) ? DURS : DURS.concat(it.min).sort((a, b) => a - b);
  const html = '<div class="sh-h"><h2>Place on calendar</h2><span class="muted small">' + fmtShort(d.date) + '</span><button class="iconbtn" data-x aria-label="Close">×</button></div>'
    + '<div class="form"><div class="row"><span class="chip" style="--c:' + catOf(CFG, it.cat).color + '"><i></i>' + esc(catOf(CFG, it.cat).name) + '</span><b>' + esc(it.title) + '</b></div>'
    + '<div class="grid2"><label class="field"><span>Start</span><input id="pStart" type="time" step="300" value="' + hm(start) + '"></label>'
    + '<label class="field"><span>Length</span><select id="pDur">' + durs.map(x => '<option value="' + x + '"' + (x === it.min ? ' selected' : '') + '>' + durTxt(x) + '</option>').join('') + '</select></label></div>'
    + '<div class="al alert" id="pErr" hidden></div></div>'
    + '<div class="sh-f"><button class="btn" data-x>Cancel</button><button class="btn pri" data-go>Place</button></div>';
  openSheet(html, sh => {
    const go = () => {
      const st = toMin($('#pStart', sh).value), du = +$('#pDur', sh).value, er = $('#pErr', sh);
      const cl = X.clashWith(d.blocks, { start: st, dur: du });
      if (cl) { er.hidden = false; er.textContent = 'Overlaps ' + clashTxt(cl) + '. Pick another time.'; return; }
      if (st + du > s.dayEnd) { er.hidden = false; er.textContent = 'Ends after ' + hm(s.dayEnd) + '. Pick an earlier time.'; return; }
      const before = clone(d);
      const b = { id: uid(), start: st, dur: du, title: it.title, cat: it.cat, status: 'planned', attach: [], pillar: false, mit: false, src: it.kind === 'todo' ? 'todo' : it.kind === 'op' ? 'saarthi' : 'bank' };
      if (it.itemId) b.itemId = it.itemId;
      d.blocks.push(b); sortBlocks(d);
      if (it.kind === 'todo') { it.x.placed = b.id; it.x.min = du; }
      else if ((d.todo || []).length < FIT_MAX) d.todo = (d.todo || []).concat({ id: uid(), title: it.title, min: du, cat: it.cat, done: false, by: 'saarthi', placed: b.id });
      saveDay(d);
      if (it.kind === 'op') { it.o.state = 'accepted'; it.o.decidedAt = Date.now(); if (window.DBXFB) DBXFB.pushInbox(fsSafe(INBOX)).catch(() => {}); }
      closeSheet(); render();
      toast(it.title + ' placed at ' + hm(st), 'Undo', () => { saveDay(before); render(); });
    };
    $('[data-go]', sh).onclick = go;
    sh.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  });
}
function bindFitDrag() {
  const box = $('.fitbox'), grid = $('#dayGrid'); if (!box || !grid) return;
  box.onpointerdown = e => {
    const row = e.target.closest('[data-drag]');
    if (!row || e.button > 0 || e.target.closest('button,input,select')) return;
    const touch = e.pointerType === 'touch', x0 = e.clientX, y0 = e.clientY;
    let armed = !touch, ghost = null, lp = null, at = null;
    if (touch) lp = setTimeout(() => { armed = true; row.classList.add('lifting'); try { navigator.vibrate && navigator.vibrate(12); } catch (_) {} }, 260);
    else e.preventDefault();
    const tm = ev => { if (armed) ev.preventDefault(); };
    const mv = ev => {
      if (!armed) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) off(); return; }
      if (!ghost) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return; ghost = document.createElement('div'); ghost.className = 'drag-ghost'; document.body.appendChild(ghost); DRAGGING = true; }
      ghost.style.left = (ev.clientX + 12) + 'px'; ghost.style.top = (ev.clientY + 10) + 'px';
      const gr = grid.getBoundingClientRect();
      if (ev.clientX >= gr.left && ev.clientX <= gr.right) { if (ev.clientY < gr.top + 36) grid.scrollTop -= 14; else if (ev.clientY > gr.bottom - 36) grid.scrollTop += 14; }
      if (ev.clientY > innerHeight - 48) scrollBy(0, 12); else if (ev.clientY < 56) scrollBy(0, -12);
      const mm = grid._minuteAt ? grid._minuteAt(ev.clientX, ev.clientY) : null;
      const inside = mm != null && ev.clientX >= gr.left && ev.clientX <= gr.right && ev.clientY >= gr.top && ev.clientY <= gr.bottom;
      at = inside ? clamp(Math.floor(mm / 15) * 15, CFG.settings.dayStart, CFG.settings.dayEnd - 15) : null;
      ghost.classList.toggle('over', inside);
      const itm = fitItem(row.dataset.drag);
      if (grid._ghost) grid._ghost(at, itm ? itm.min : 30);
      ghost.textContent = row.dataset.label + (at != null ? ' · ' + hm(at) : ' · drop on the calendar');
    };
    const up = () => { const drop = at; const was = !!ghost; off(); if (was && drop != null) openPlace(row.dataset.drag, drop); };
    const off = () => {
      clearTimeout(lp);
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', off);
      document.removeEventListener('touchmove', tm);
      row.classList.remove('lifting'); if (ghost) ghost.remove(); ghost = null; if (grid._ghost) grid._ghost(null);
      setTimeout(() => { DRAGGING = false; }, 0);
    };
    document.addEventListener('touchmove', tm, { passive: false });
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', off);
  };
}
function viewToday() {
  const t = today(), d = day(CUR), isToday = CUR === t, past = CUR < t, s = CFG.settings, nm = nowMin();
  AG_DAY = d;
  const phone = isPhone();
  const twice = CUR <= t ? X.missedYesterday(STORE, CFG, CUR) : new Set();
  const pc = X.principleChecks(CFG, d, twice);
  const sc = statusCounts(d);
  const free = X.gaps(d.blocks, isToday ? Math.max(s.dayStart, nm) : s.dayStart, s.bedtime, 15).reduce((a, g) => a + g.end - g.start, 0);
  const pil = X.dayStats(CFG, d);
  const yday = DAYS[addDays(CUR, -1)];
  const ws0 = weekStart(CUR);
  const strip = '<div class="dstrip"><button class="ds-arrow" data-act="dsweek" data-w="-7" aria-label="Previous week">' + ic('left') + '</button>'
    + [0, 1, 2, 3, 4, 5, 6].map(i => { const k = addDays(ws0, i), dd = X.parseKey(k); return '<button class="ds-day' + (k === CUR ? ' on' : '') + (k === t ? ' today' : '') + '" data-act="dsgo" data-d="' + k + '"><span>' + DOW[dd.getDay()] + '</span><b>' + dd.getDate() + '</b></button>'; }).join('')
    + '<button class="ds-arrow" data-act="dsweek" data-w="7" aria-label="Next week">' + ic('right') + '</button></div>';
  const actions = strip + (isToday ? '' : '<button class="btn" data-act="gotoday">Today</button>')
    + '<button class="btn" data-act="print" aria-label="Print">' + ic('print') + (phone ? '' : 'Print') + '</button>'
    + (CUR <= t ? '<button class="btn pri" data-act="close">Close day</button>' : '');
  let top = '';
  if (!localStorage.getItem(LS_ONB)) top += '<div class="card inbox" style="margin-bottom:12px"><h3>Welcome to DayBox</h3><ol class="small" style="margin:0 0 10px;padding-left:18px"><li>Sign in with Google (the same account as Tenfold) so it syncs to your phone.</li><li>When a block ends, tap ✓ or ✗. That is all the logging.</li><li>Bored or free? Press <b>What now?</b></li></ol><div class="row"><button class="btn pri sm" data-act="signin">Sign in</button><button class="btn ghost sm" data-act="onb">Got it</button></div></div>';
  const statTxt = d.untracked ? '' : '<span>' + Math.round(pc.pct * 100) + '% booked</span><span>' + durTxt(free) + ' free</span>' + (pil.pillarsPlanned ? '<span>' + pil.pillarsKept + '/' + pil.pillarsPlanned + ' pillars</span>' : '') + (sc.past ? '<span>' + sc.marked + '/' + sc.past + ' marked</span>' : '');
  if (isToday) top += nowBarHtml(d, statTxt);
  if (isToday && pendingOps()) top += '<div class="al" style="margin-bottom:10px">' + ic('saarthi', 's-ic') + '<span>Saarthi has <b>' + pendingOps() + '</b> suggestions.</span><button class="btn sm x" data-act="nav" data-v="saarthi">Open</button></div>';
  if (yday && yday.close && yday.close.mit && isToday) top += '<div class="al" style="margin-bottom:10px">★ <span>Today\'s MIT (from last night): <b>' + esc(yday.close.mit) + '</b></span></div>';
  if (d.untracked) top += '<div class="untracked">' + ic('lock', 's-ic') + '<span>Not tracked. DayBox was not used this day.</span><button class="btn sm" data-act="track-empty">Add what happened</button><button class="btn sm" data-act="track-routine">Fill from routine</button></div>';
  else if (d.virtual) top += '<div class="untracked">Preview from your routine' + (d.tpl ? ' (' + esc(d.tpl.name) + ')' : '') + '. It saves when you change something.</div>';
  if (!d.untracked) {
    const dis = dismissed(CUR);
    const offers = isToday ? X.backupOffers(d, nm) : [];
    const must = pc.list.filter(a => a.lvl === 'alert' && !dis.includes(a.t));
    const tips = pc.list.filter(a => a.lvl !== 'alert' && !dis.includes(a.t));
    const extra = (slipOn(CUR) ? '<span class="warn-t">sanyam slip logged</span>' : '') + (tips.length ? '<button class="linkbtn" data-act="tips">' + tips.length + ' tip' + (tips.length > 1 ? 's' : '') + ' ' + (TIPS_OPEN ? '▾' : '▸') + '</button>' : '');
    if (!isToday || extra) top += '<div class="sumline">' + (isToday ? '' : statTxt) + extra + '</div>';
    const shown = must.concat(TIPS_OPEN ? tips : []);
    if (offers.length || shown.length)
      top += '<div class="alerts">' + offers.map(o => '<div class="al alert"><span>Missed <b>' + esc(o.block.title) + '</b>. Backup is ready.</span><button class="btn sm x" data-act="backup" data-id="' + o.block.id + '" data-at="' + o.at + '">Use backup ' + hm(o.at) + '</button></div>').join('')
        + shown.map(a => '<div class="al ' + a.lvl + '"><span>' + esc(a.t) + '</span><button class="btn ghost sm x" data-act="dismiss" data-t="' + esc(a.t) + '" aria-label="Dismiss">×</button></div>').join('') + '</div>';
  }
  const col = { day: d, date: CUR, blocks: d.blocks, editable: true, past, virtual: d.virtual && !d.untracked, showGaps: !past, twice };
  const grid = '<div class="gwrap daygrid" id="dayGrid">' + dayGridHtml(col) + '</div>';
  const hint = '';
  let body;
  // one calendar only: the To fit list sits beside (laptop) or above (phone) the timeline
  const fit = fitHtml(d);
  if (phone || !fit) body = top + fit + grid + hint;
  else body = top + '<div class="tsplit"><div class="tleft">' + grid + hint + '</div><div class="tright">' + fit + '</div></div>';
  const showGrid = true;
  return {
    title: isToday ? 'Today' : fmtShort(CUR), sub: fmtLong(CUR) + (d.tpl ? ' · ' + esc(d.tpl.name) : ''), actions, body,
    after() {
      const fi = $('#fitTitle'); if (fi) fi.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); fitAdd(); } };
      if (!showGrid) return;
      const gw = $('#dayGrid');
      // one row per hour, sized so the whole day fits the window (phone: fixed rows, scrolls)
      const rows = dgRows().length;
      const ideal = phone ? 40 : clamp(Math.floor((innerHeight - gw.getBoundingClientRect().top - scrollY - 24 - 24) / rows), 30, 56);
      if (ideal !== ROW_H) { ROW_H = ideal; return render(); }
      bindDayGrid(gw, col, dayHandlers);
      bindFitDrag();
      if (SCROLL_NOW) {
        SCROLL_NOW = false;
        const first = d.blocks.filter(b => b.cat !== 'sleep').reduce((m, b) => Math.min(m, b.start), 1440);
        const target = isToday ? nm : (first < 1440 ? first : s.dayStart);
        gw.scrollTop = Math.max(0, (Math.floor(target / 60) - Math.floor(s.dayStart / 60) - 1) * ROW_H);
      }
    },
  };
}
function weekCounters(days) {
  const items = X.candidates(CFG, TF).filter(i => i.kind === 'regular');
  if (!items.length) return '';
  return '<div class="card" style="margin-bottom:12px"><h3>3x a week</h3><div class="list">' + items.map(it => {
    const c = catOf(CFG, it.cat), done = X.itemCount(days, it), plan = X.itemCount(days, it, ['planned']), per = it.perWeek || 3;
    const dots = []; for (let i = 0; i < Math.max(per, done + plan); i++) dots.push('<i class="' + (i < done ? 'f' : i < done + plan ? 'p' : '') + '"></i>');
    return '<div class="li" style="--c:' + c.color + '"><span class="sw"></span><div><div class="t">' + esc(it.title) + '</div><div class="m">' + esc(c.name) + (it.src === 'tenfold' ? ' · Tenfold goal' : '') + ' · ' + done + ' done, ' + plan + ' planned</div></div><span class="dots" style="--c:' + c.color + '">' + dots.join('') + '</span></div>';
  }).join('') + '</div></div>';
}
function balanceBars(rows, title) {
  return '<div class="card"><h3>' + title + '</h3>' + rows.map(r => { const c = catOf(CFG, r.cat); return '<div class="hbar" style="--c:' + c.color + '"><span>' + esc(c.name) + '</span><div class="track"><i style="width:' + Math.round(r.share * 100) + '%"></i><b style="left:' + Math.round(r.target * 100) + '%" title="target"></b></div><span class="mono small">' + Math.round(r.share * 100) + '% / ' + Math.round(r.target * 100) + '%</span></div>'; }).join('') + '<p class="hint" style="margin:8px 0 0">Bar = your share of free time this week (planned + done). Line = your target.</p></div>';
}
function viewWeek() {
  const t = today(), dates = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(WEEK, i)), days = dates.map(day);
  const ppm = isPhone() ? 0.6 : 0.62;
  const cols = days.map((d, i) => {
    const pc = X.principleChecks(CFG, d, null), st = statusCounts(d);
    return { day: d, date: dates[i], blocks: d.blocks, editable: true, past: dates[i] < t, virtual: d.virtual, label: DOW[dow(dates[i])] + ' ' + X.parseKey(dates[i]).getDate(),
      sub: d.untracked ? 'not tracked' : Math.round(pc.pct * 100) + '% booked' + (st.past ? ' · ' + st.marked + '/' + st.past : ''), twice: dates[i] <= t ? X.missedYesterday(STORE, CFG, dates[i]) : null };
  });
  const bal = X.balanceState(CFG, days);
  const body = '<div class="cols2" style="margin-bottom:12px">' + (weekCounters(days) || '<div></div>') + balanceBars(bal.rows, 'Balance this week') + '</div>'
    + '<div class="gwrap" id="weekGrid">' + gridHtml(cols, 'week', ppm) + '</div>'
    + '<p class="hint" style="margin-top:10px">Drag a block to another day to move it. Click a day name to open it.</p>';
  const end = addDays(WEEK, 6);
  return {
    title: 'Week', sub: fmtShort(WEEK) + ' – ' + fmtShort(end),
    actions: '<button class="iconbtn" data-act="wprev" aria-label="Previous week">' + ic('left') + '</button><button class="iconbtn" data-act="wnext" aria-label="Next week">' + ic('right') + '</button>' + (WEEK === weekStart(t) ? '' : '<button class="btn" data-act="wtoday">This week</button>') + '<button class="btn" data-act="nav" data-v="plan">' + ic('plan') + 'Thursday plan</button>',
    body, after() { bindGrid($('#weekGrid'), cols, 'week', ppm, dayHandlers); },
  };
}
const PLAN_DEF = { career: [0, 600], relationship: [2, 1230], self: [3, 420], big: [5, 900], little: [4, 1020], younight: [1, 1260] };
const PLAN_HINT = {
  career: 'One thing that moves work forward.', relationship: 'One thing for one person (partner, kid, friend).', self: 'One thing just for you: health, hobby, rest.',
  big: '3-4 hours, weekend. Could you describe it a month later?', little: '1 hour, Friday 17:00 by default.', younight: 'One weeknight that is yours. Tuesday 21:00, backup Thursday.',
};
function viewPlan() {
  const t = today(), thisWs = weekStart(t), ws = PLAN_WS || addDays(thisWs, 7);
  const wp = CFG.weekPlans[ws] || {};
  const dates = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(ws, i));
  const dreams = CFG.items.filter(i => i.kind === 'dream' && !i.done && !i.deleted);
  const rows = Object.keys(X.WEEK_SLOTS).map(k => {
    const m = X.WEEK_SLOTS[k], v = wp[k] || {}, def = PLAN_DEF[k];
    const dsel = v.date || dates[def[0]], st = v.start != null ? v.start : def[1], du = v.dur || m.dur;
    const list = k === 'big' || k === 'little' ? 'pDreams' : '';
    return '<div class="card" data-k="' + k + '" style="--c:' + catOf(CFG, m.cat).color + '"><div class="row" style="margin-bottom:8px"><span class="chip"><i></i>' + m.label + '</span><span class="muted small">' + PLAN_HINT[k] + '</span></div>'
      + '<div class="grid2"><input type="text" data-f="text" value="' + esc(v.text || '') + '" placeholder="' + m.label + '..."' + (list ? ' list="' + list + '"' : '') + '>'
      + '<div class="row" style="flex-wrap:nowrap"><select data-f="date">' + dates.map(dd => '<option value="' + dd + '"' + (dd === dsel ? ' selected' : '') + '>' + fmtShort(dd) + '</option>').join('') + '</select>'
      + '<input type="time" step="300" data-f="start" value="' + hm(st) + '"><select data-f="dur">' + DURS.map(x => '<option value="' + x + '"' + (x === du ? ' selected' : '') + '>' + durTxt(x) + '</option>').join('') + '</select></div></div></div>';
  }).join('');
  const body = '<p class="hint">Plan on Thursday 16:35, before you are inside the week. One line each. Every line gets a day and a time, or it is only a wish. Pick adventures from your dream list, never from a blank page.</p>'
    + '<datalist id="pDreams">' + dreams.map(i => '<option value="' + esc(i.title) + '">').join('') + '</datalist>' + rows
    + '<div class="row" style="margin-top:14px"><button class="btn pri" data-act="plansave">Add to the week</button><span class="muted small">Blocks show up in the week. Days you already changed get them added too.</span></div>';
  return {
    title: 'Thursday plan', sub: 'week of ' + fmtShort(ws),
    actions: '<div class="seg"><button class="' + (ws === thisWs ? 'on' : '') + '" data-act="planws" data-ws="' + thisWs + '">This week</button><button class="' + (ws === addDays(thisWs, 7) ? 'on' : '') + '" data-act="planws" data-ws="' + addDays(thisWs, 7) + '">Next week</button></div>',
    body,
  };
}
function savePlan() {
  const ws = PLAN_WS || addDays(weekStart(today()), 7), t = today();
  const wp = {};
  $$('#view .card[data-k]').forEach(c => {
    const g = f => c.querySelector('[data-f="' + f + '"]').value;
    const text = g('text').trim(); if (!text) return;
    const item = CFG.items.find(i => norm(i.title) === norm(text));
    wp[c.dataset.k] = { text, date: g('date'), start: toMin(g('start')), dur: +g('dur'), itemId: item ? item.id : null };
  });
  const base = Object.assign({}, CFG, { weekPlans: {} });
  const L = X.WEEK_SLOTS;
  for (const k of Object.keys(wp)) {
    const v = wp[k], cand = { start: v.start, dur: v.dur };
    const fixed = X.buildDay(base, v.date).blocks.filter(b => b.src === 'rule' && !((k === 'little' && /little adventure/i.test(b.title)) || (k === 'younight' && /you-?night/i.test(b.title))));
    const cl = X.clashWith(fixed, cand) || Object.keys(wp).filter(j => j !== k && wp[j].date === v.date).map(j => ({ title: L[j].label, start: wp[j].start, dur: wp[j].dur })).find(o => X.overlaps(o, cand));
    if (cl) return toast(L[k].label + ' on ' + fmtShort(v.date) + ' overlaps ' + clashTxt(cl) + '. Change its time.', null, null, 8000);
  }
  CFG.weekPlans[ws] = wp; saveCfg();
  for (let i = 0; i < 7; i++) {
    const date = addDays(ws, i), d = DAYS[date];
    if (!d || date < t) continue;
    d.blocks = d.blocks.filter(b => b.src !== 'week');
    const items = X.weekItemsFor(CFG, date);
    if (items.some(w => w.wk === 'little')) d.blocks = d.blocks.filter(b => !(b.src === 'rule' && b.status === 'planned' && /little adventure/i.test(b.title)));
    if (items.some(w => w.wk === 'younight')) d.blocks = d.blocks.filter(b => !(b.src === 'rule' && b.status === 'planned' && /you-?night/i.test(b.title)));
    items.forEach(w => d.blocks.push(X.blockFrom(w, { src: 'week', wk: w.wk })));
    sortBlocks(d); saveDay(d);
  }
  toast(Object.keys(wp).length + ' lines added to the week of ' + fmtShort(ws));
  render();
}

/* ---------- bank ---------- */
function itemMeta(it) {
  const c = catOf(CFG, it.cat);
  return esc(c.name) + ' · ' + durTxt(it.min || 30) + (it.kind === 'regular' ? ' · ' + (it.perWeek || 3) + 'x/week' : '') + ' · ' + (it.energy === 'deep' ? 'deep focus' : 'light') + (it.zone && it.zone !== 'any' ? ' · ' + it.zone : '') + (it.needs ? ' · needs ' + esc(it.needs) : '');
}
function viewBank() {
  const tab = TAB.bank, t = today();
  const days = X.weekDays(STORE, CFG, t, t);
  const tabs = [['regular', 'Regular'], ['dreams', 'Dream list'], ['tenfold', 'Tenfold goals'], ['balance', 'Balance'], ['boredom', 'Boredom list']];
  let body = '<div class="tabs">' + tabs.map(([k, l]) => '<button class="' + (tab === k ? 'on' : '') + '" data-act="tab" data-g="bank" data-k="' + k + '">' + l + '</button>').join('') + '</div>';
  if (tab === 'regular' || tab === 'dreams') {
    const kind = tab === 'regular' ? 'regular' : 'dream';
    const list = CFG.items.filter(i => !i.deleted && i.kind === kind);
    const open = list.filter(i => !i.done), done = list.filter(i => i.done);
    body += '<p class="hint">' + (kind === 'regular' ? 'Things you want 3x a week (or your number). What now? and Fill free time pick the ones that are behind.' : 'Everything you dream of doing: hobbies, fun, places, people, learning. Free time gets filled from here instead of the phone, balanced by your mix.') + '</p>';
    body += '<div class="card"><div class="list">' + (open.length ? open.map(it => {
      const c = catOf(CFG, it.cat);
      const right = kind === 'regular' ? '<span class="dots" style="--c:' + c.color + '">' + Array.from({ length: it.perWeek || 3 }, (_, i) => '<i class="' + (i < X.itemCount(days, it) ? 'f' : '') + '"></i>').join('') + '</span>' : '<span class="row"><button class="btn sm" data-act="planit" data-id="' + it.id + '">Plan it</button><button class="btn sm" data-act="dreamdone" data-id="' + it.id + '">' + ic('check') + 'Done</button></span>';
      return '<div class="li" style="--c:' + c.color + '"><span class="sw"></span><div data-act="item" data-id="' + it.id + '" style="cursor:pointer"><div class="t">' + esc(it.title) + '</div><div class="m">' + itemMeta(it) + '</div></div>' + right + '</div>';
    }).join('') : '<div class="empty">Nothing here yet.</div>') + '</div><div style="margin-top:10px"><button class="btn pri sm" data-act="item" data-kind="' + kind + '">' + ic('plus') + 'Add</button></div></div>';
    if (done.length) body += '<div class="card"><h3>Done</h3><div class="list">' + done.map(it => '<div class="li" style="--c:' + catOf(CFG, it.cat).color + '"><span class="sw"></span><div data-act="item" data-id="' + it.id + '" style="cursor:pointer"><div class="t">' + esc(it.title) + '</div><div class="m">done ' + (it.doneAt ? fmtShort(it.doneAt) : '') + '</div></div><button class="btn sm" data-act="dreamdone" data-id="' + it.id + '">Undo</button></div>').join('') + '</div></div>';
  } else if (tab === 'tenfold') {
    const gs = X.tfGoals(CFG, TF);
    body += '<p class="hint">Read-only from Tenfold. DayBox never writes to Tenfold. Turn a goal on and it competes for free slots, balanced against hobbies and fun.</p>'
      + '<label class="check" style="margin-bottom:12px"><input type="checkbox" id="tfOn"' + (CFG.tf.on ? ' checked' : '') + '> Use Tenfold goals in suggestions</label>';
    if (!TF) body += '<div class="empty">No Tenfold data found. Sign in with the same Google account as Tenfold, or open DayBox in the same browser where you use Tenfold.</div>';
    else if (!gs.length) body += '<div class="empty">No open Live, Quarter or Yearly goals in Tenfold.</div>';
    else body += '<div class="card"><table class="tbl" id="tfTbl"><thead><tr><th>Goal</th><th>Use</th><th>Category</th><th>Minutes</th><th>Per week</th></tr></thead><tbody>' + gs.map(g => '<tr data-id="' + esc(g.id) + '"><td style="text-align:left"><b>' + esc(g.name) + '</b><div class="muted small">' + esc(g.secLabel) + ' · ' + esc(g.tfCat || '') + (g.target ? ' · ' + (g.cur || 0) + '/' + g.target + ' ' + esc(g.unit || '') : '') + '</div></td><td><input type="checkbox" data-f="on"' + (g.on ? ' checked' : '') + '></td><td><select data-f="cat">' + catOptions(g.cat) + '</select></td><td><input type="number" min="10" step="5" data-f="min" value="' + g.min + '" style="width:76px"></td><td><input type="number" min="1" max="14" data-f="perWeek" value="' + g.perWeek + '" style="width:64px"></td></tr>').join('') + '</tbody></table></div>';
  } else if (tab === 'balance') {
    const free = CFG.cats.filter(c => c.group === 'free'), b = CFG.settings.balance;
    const sum = free.reduce((a, c) => a + (+b[c.id] || 0), 0);
    body += '<p class="hint">How you want your free time split. Default: goals = fun (hobby + leisure), then family and health. Suggestions push whatever is behind.</p>'
      + '<div class="cols2"><div class="card"><h3>Your mix</h3>' + free.map(c => '<div class="hbar" style="--c:' + c.color + '"><span>' + esc(c.name) + '</span><input type="range" min="0" max="60" step="5" data-bal="' + c.id + '" value="' + (+b[c.id] || 0) + '"><span class="mono small" id="bv_' + c.id + '">' + (+b[c.id] || 0) + '%</span></div>').join('')
      + '<p class="hint" id="balSum" style="margin:8px 0 0">Total ' + sum + '% (it is scaled to 100%).</p></div>' + balanceBars(X.balanceState(CFG, days).rows, 'This week so far') + '</div>';
  } else {
    body += '<p class="hint">Rule D: boredom is the trigger. Write five things under 20 minutes. When bored, you look here, not at the phone.</p>'
      + '<div class="card"><textarea id="boredTxt" rows="7">' + esc(CFG.boredom.join('\n')) + '</textarea><div style="margin-top:8px"><button class="btn pri sm" data-act="boredsave">Save</button></div></div>';
  }
  return {
    title: 'Bank', sub: 'what fills your free time', body,
    after() {
      const on = $('#tfOn'); if (on) on.onchange = () => { CFG.tf.on = on.checked; saveCfg(); };
      const tb = $('#tfTbl');
      if (tb) tb.onchange = e => {
        const tr = e.target.closest('tr'); const id = tr.dataset.id, f = e.target.dataset.f;
        const g = X.tfGoals(CFG, TF).find(x => x.id === id) || {};
        const m = CFG.tf.goalMap[id] = Object.assign({ on: g.on, cat: g.cat, min: g.min, perWeek: g.perWeek }, CFG.tf.goalMap[id] || {});
        m[f] = f === 'on' ? e.target.checked : f === 'cat' ? e.target.value : Math.max(1, +e.target.value || 1);
        saveCfg();
      };
      $$('[data-bal]').forEach(r => {
        r.oninput = () => { $('#bv_' + r.dataset.bal).textContent = r.value + '%'; const sum = $$('[data-bal]').reduce((a, x) => a + +x.value, 0); $('#balSum').textContent = 'Total ' + sum + '% (it is scaled to 100%).'; };
        r.onchange = () => { CFG.settings.balance[r.dataset.bal] = +r.value; saveCfg(); render(); };
      });
    },
  };
}
function openItem(id, kind) {
  const it = id ? CFG.items.find(i => i.id === id) : { kind: kind || 'dream', title: '', cat: kind === 'regular' ? 'goal' : 'hobby', min: 30, perWeek: 3, energy: 'light', zone: 'any', needs: '' };
  const html = '<div class="sh-h"><h2>' + (id ? 'Edit' : 'Add') + ' ' + (it.kind === 'regular' ? 'regular thing' : 'dream') + '</h2><button class="iconbtn" data-x aria-label="Close">×</button></div><div class="form">'
    + '<label class="field"><span>Title</span><input id="iTitle" type="text" value="' + esc(it.title) + '" placeholder="' + (it.kind === 'regular' ? 'e.g. Study' : 'e.g. Learn to make pizza') + '"></label>'
    + '<div class="grid3"><label class="field"><span>Kind</span><select id="iKind"><option value="regular"' + (it.kind === 'regular' ? ' selected' : '') + '>Regular (x/week)</option><option value="dream"' + (it.kind === 'dream' ? ' selected' : '') + '>Dream</option></select></label>'
    + '<label class="field"><span>Category</span><select id="iCat">' + catOptions(it.cat) + '</select></label>'
    + '<label class="field"><span>Minutes</span><input id="iMin" type="number" min="5" step="5" value="' + (it.min || 30) + '"></label></div>'
    + '<div class="grid3"><label class="field" id="iPerF"' + (it.kind === 'regular' ? '' : ' hidden') + '><span>Times per week</span><input id="iPer" type="number" min="1" max="14" value="' + (it.perWeek || 3) + '"></label>'
    + '<label class="field"><span>Energy</span><select id="iEn"><option value="light"' + (it.energy !== 'deep' ? ' selected' : '') + '>Light</option><option value="deep"' + (it.energy === 'deep' ? ' selected' : '') + '>Deep focus</option></select></label>'
    + '<label class="field"><span>Best time</span><select id="iZone">' + ['any', 'morning', 'afternoon', 'evening'].map(z => '<option value="' + z + '"' + ((it.zone || 'any') === z ? ' selected' : '') + '>' + z + '</option>').join('') + '</select></label></div>'
    + '<label class="field"><span>Needs (person, money, place)</span><input id="iNeeds" type="text" value="' + esc(it.needs || '') + '"></label>'
    + '</div><div class="sh-f">' + (id ? '<button class="btn danger l" data-del>Delete</button>' : '') + '<button class="btn" data-x>Cancel</button><button class="btn pri" data-save>Save</button></div>';
  openSheet(html, sh => {
    $('#iKind', sh).onchange = e => { $('#iPerF', sh).hidden = e.target.value !== 'regular'; };
    const del = $('[data-del]', sh); if (del) del.onclick = () => { it.deleted = true; saveCfg(); closeSheet(); render(); toast('Deleted', 'Undo', () => { it.deleted = false; saveCfg(); render(); }); };
    $('[data-save]', sh).onclick = () => {
      const title = $('#iTitle', sh).value.trim(); if (!title) return $('#iTitle', sh).focus();
      Object.assign(it, { title, kind: $('#iKind', sh).value, cat: $('#iCat', sh).value, min: Math.max(5, +$('#iMin', sh).value || 30), perWeek: Math.max(1, +$('#iPer', sh).value || 3), energy: $('#iEn', sh).value, zone: $('#iZone', sh).value, needs: $('#iNeeds', sh).value.trim() });
      if (!id) { it.id = uid(); CFG.items.push(it); }
      saveCfg(); closeSheet(); render();
    };
  });
}
function planIt(id) {
  const it = CFG.items.find(i => i.id === id); if (!it) return;
  const t = today(), s = CFG.settings, need = it.min || 30;
  for (let i = 0; i < 14; i++) {
    const date = addDays(t, i), d = day(date);
    const from = i === 0 ? Math.max(s.dayStart, Math.ceil(nowMin() / 15) * 15) : s.dayStart;
    const gs = X.gaps(d.blocks, from, s.bedtime, need).filter(g => need < 120 || dow(date) === 0 || dow(date) === 6);
    const g = gs.find(x => !it.zone || it.zone === 'any' || zoneOf(x.start) === it.zone) || gs[0];
    if (!g) continue;
    const before = clone(d);
    d.blocks.push({ id: uid(), start: g.start, dur: need, title: it.title, cat: it.cat, itemId: it.id, src: 'bank', status: 'planned', attach: [], pillar: false, mit: false });
    sortBlocks(d); saveDay(d); render();
    return toast('Planned ' + it.title + ': ' + fmtShort(date) + ' ' + hm(g.start), 'Undo', () => { saveDay(before); render(); }, 7000);
  }
  toast('No free slot of ' + durTxt(need) + ' in the next 2 weeks.');
}

/* ---------- routine ---------- */
function daysTxt(ds) { const s = (ds || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); if (s.length === 7) return 'Every day'; if (s.join() === '1,2,3,4,5') return 'Mon–Fri'; if (s.join() === '6,0') return 'Weekend'; return s.map(d => DOW[d]).join(' '); }
function viewRoutine() {
  const t = today();
  let body = '<p class="hint">Your routine: blocks that repeat on set weekdays. Editing one starts from today, past days keep the old time. A new block trims the plain blocks it lands on, but never a pillar.</p>';
  const liveR = CFG.rules.filter(r => X.ruleLive(r, t)).sort((a, b) => a.start - b.start || a.days[0] - b.days[0]);
  const old = CFG.rules.filter(r => !r.deleted && r.to && r.to < t);
  body += '<div class="card"><div class="list">' + liveR.map(r => { const c = catOf(CFG, r.cat); return '<div class="li" style="--c:' + c.color + '"><span class="sw"></span><div data-act="rule" data-id="' + r.id + '" style="cursor:pointer"><div class="t">' + (r.pillar ? ic('lock', 's-ic') + ' ' : '') + esc(r.title) + '</div><div class="m"><span class="mono">' + hm(r.start) + '–' + hm(r.start + r.dur) + '</span> · ' + daysTxt(r.days) + ' · ' + esc(c.name) + (r.pillar ? (r.strict ? ' · strict, no backup' : r.backup != null ? ' · backup ' + hm(r.backup) : '') : '') + (r.from && r.from > '2000-01-01' ? ' · from ' + fmtShort(r.from) : '') + '</div></div><button class="btn sm" data-act="rule" data-id="' + r.id + '">Edit</button></div>'; }).join('') + '</div><div style="margin-top:10px"><button class="btn pri sm" data-act="rule">' + ic('plus') + 'Add recurring block</button></div></div>';
  if (old.length) body += '<div class="card"><h3>Past versions</h3><div class="list">' + old.map(r => '<div class="li"><span class="chip">' + (r.from && r.from > '2000-01-01' ? fmtShort(r.from) : 'start') + ' → ' + fmtShort(r.to) + '</span><div><div class="t">' + esc(r.title) + '</div><div class="m mono">' + hm(r.start) + '–' + hm(r.start + r.dur) + ' · ' + daysTxt(r.days) + '</div></div><span></span></div>').join('') + '</div></div>';
  return { title: 'Routine', sub: 'recurring blocks', body };
}
function openRule(id) {
  const t = today();
  const r = id ? CFG.rules.find(x => x.id === id) : { title: '', cat: 'pillar', start: 540, dur: 30, days: [1, 2, 3, 4, 5], pillar: false, backup: null, strict: false, attach: [] };
  const html = '<div class="sh-h"><h2>' + (id ? 'Edit' : 'Add') + ' recurring block</h2><button class="iconbtn" data-x aria-label="Close">×</button></div><div class="form">'
    + '<label class="field"><span>Title</span><input id="rTitle" type="text" value="' + esc(r.title) + '"></label>'
    + '<div class="grid3"><label class="field"><span>Category</span><select id="rCat">' + catOptions(r.cat) + '</select></label><label class="field"><span>Start</span><input id="rStart" type="time" step="300" value="' + hm(r.start) + '"></label><label class="field"><span>Length</span><select id="rDur">' + (DURS.includes(r.dur) ? DURS : DURS.concat(r.dur).sort((a, b) => a - b)).map(x => '<option value="' + x + '"' + (x === r.dur ? ' selected' : '') + '>' + durTxt(x) + '</option>').join('') + '</select></label></div>'
    + '<div class="field"><span>Days</span><div class="seg" id="rDays">' + [1, 2, 3, 4, 5, 6, 0].map(d => '<button type="button" data-d="' + d + '" class="' + (r.days.includes(d) ? 'on' : '') + '">' + DOW[d] + '</button>').join('') + '</div></div>'
    + '<div class="row"><label class="check"><input id="rPillar" type="checkbox"' + (r.pillar ? ' checked' : '') + '> Pillar (never moves)</label><label class="check"><input id="rStrict" type="checkbox"' + (r.strict ? ' checked' : '') + '> Strict, no backup</label></div>'
    + '<label class="field"><span>Backup slot, same day (pillars)</span><input id="rBackup" type="time" step="300" value="' + (r.backup != null ? hm(r.backup) : '') + '"></label>'
    + '<label class="field"><span>Small things attached (comma separated)</span><input id="rAttach" type="text" value="' + esc((r.attach || []).join(', ')) + '"></label>'
    + (id ? '<label class="check"><input id="rToday" type="checkbox" checked> Also change today</label>' : '')
    + '<p class="hint" style="margin:0">Applies from today on. Saved past days keep the old time.</p>'
    + '</div><div class="sh-f">' + (id ? '<button class="btn danger l" data-del>End it</button>' : '') + '<button class="btn" data-x>Cancel</button><button class="btn pri" data-save>Save</button></div>';
  openSheet(html, sh => {
    let days = r.days.slice();
    $$('#rDays button', sh).forEach(b => { b.onclick = () => { const d = +b.dataset.d; days = days.includes(d) ? days.filter(x => x !== d) : days.concat(d); b.classList.toggle('on'); }; });
    const del = $('[data-del]', sh);
    if (del) del.onclick = () => { X.endRule(CFG, id, t); saveCfg(); closeSheet(); render(); toast(r.title + ' ends today. Past days keep it.'); };
    $('[data-save]', sh).onclick = () => {
      const title = $('#rTitle', sh).value.trim(); if (!title) return $('#rTitle', sh).focus();
      const pillar = $('#rPillar', sh).checked, strict = pillar && $('#rStrict', sh).checked, bv = $('#rBackup', sh).value;
      const patch = { title, cat: $('#rCat', sh).value, start: toMin($('#rStart', sh).value), dur: +$('#rDur', sh).value, days, pillar, strict, backup: pillar && !strict && bv ? toMin(bv) : null, attach: $('#rAttach', sh).value.split(',').map(x => x.trim()).filter(Boolean) };
      const mr = X.makeRoom(CFG, Object.assign({ id: id || '_new' }, patch), id, t);
      if (mr.error) return toast(mr.error + '. Pick another time.', null, null, 7000);
      if (mr.trimmed.length) toast('Made room: trimmed ' + mr.trimmed.join(', ') + ' from today.', null, null, 6000);
      if (!id) CFG.rules.push(Object.assign({ id: uid(), from: t, to: null }, patch));
      else {
        const nr = X.editRule(CFG, id, patch, t);
        const td = DAYS[t];
        if ($('#rToday', sh).checked && td) {
          td.blocks.forEach(b => { if (b.ruleId === id && b.status === 'planned') Object.assign(b, X.blockFrom(nr, { id: b.id, src: 'rule', ruleId: nr.id })); });
          if (nr.days.includes(dow(t)) && !td.blocks.some(b => b.ruleId === nr.id)) td.blocks.push(X.blockFrom(nr, { src: 'rule', ruleId: nr.id }));
          sortBlocks(td); saveDay(td);
        }
      }
      saveCfg(); closeSheet(); render();
    };
  });
}
/* ---------- insights ---------- */
function fmtVal(v, f) { if (v == null) return '–'; return f === 'pct' ? Math.round(v * 100) + '%' : durTxt(v); }
function viewInsights() {
  const t = today(), r = TAB.insights;
  const span = r === '7' ? 6 : r === '28' ? 27 : 89;
  const from = addDays(t, -span), rep = X.rangeReport(CFG, STORE, from, t);
  const dir = X.direction(CFG, STORE, t);
  let body = '<div class="dir">' + dir.map(m => {
    const arrow = !m.enough ? '<span class="arrow flat">needs 2 weeks of data</span>' : m.dir === 'flat' || m.good == null ? '<span class="arrow flat">→ steady</span>' : '<span class="arrow ' + (m.good ? 'good' : 'bad') + '">' + (m.dir === 'up' ? '↑' : '↓') + ' ' + (m.good ? 'better' : 'worse') + ' vs ' + fmtVal(m.before, m.fmt) + '</span>';
    return '<div class="card"><div class="lbl">' + m.label + '</div><div class="v">' + fmtVal(m.now, m.fmt) + '</div>' + arrow + '</div>';
  }).join('') + '</div><p class="hint" style="margin-top:-6px">Direction: last 7 days vs the 4 weeks before.</p>';
  if (!rep.tracked) {
    body += '<div class="empty">No tracked days in this range yet. Mark your blocks (done or skipped) and this fills up.</div>';
  } else {
    const cats = CFG.cats.filter(c => Object.keys(rep.actual).includes(c.id));
    let buckets;
    if (r === '90') { buckets = []; for (let ws = weekStart(from); ws <= t; ws = addDays(ws, 7)) { const we = addDays(ws, 6); const ds = rep.days.filter(s => s.date >= ws && s.date <= we); const a = {}; ds.forEach(s => Object.entries(s.actual).forEach(([k, v]) => { a[k] = (a[k] || 0) + v; })); buckets.push({ label: X.parseKey(ws).getDate() + '/' + (X.parseKey(ws).getMonth() + 1), a }); } }
    else { buckets = []; for (let i = span; i >= 0; i--) { const d = addDays(t, -i); const s = rep.days.find(x => x.date === d); buckets.push({ label: r === '7' ? DOW[dow(d)] : String(X.parseKey(d).getDate()), a: s ? s.actual : {} }); } }
    const max = Math.max(60, ...buckets.map(b => Object.values(b.a).reduce((x, y) => x + y, 0)));
    body += '<div class="card"><h3>Where your time went</h3><div class="row" style="margin-bottom:8px">' + cats.map(c => '<span class="chip" style="--c:' + c.color + '"><i></i>' + esc(c.name) + '</span>').join('') + '</div>'
      + '<div class="bars">' + buckets.map(b => '<div class="col" title="' + esc(b.label) + ': ' + durTxt(Object.values(b.a).reduce((x, y) => x + y, 0)) + '">' + cats.map(c => b.a[c.id] ? '<i style="--c:' + c.color + ';height:' + (b.a[c.id] / max * 100) + '%"></i>' : '').join('') + '</div>').join('') + '</div>'
      + '<div class="bars-x">' + buckets.map(b => '<span>' + esc(b.label) + '</span>').join('') + '</div><p class="hint" style="margin:8px 0 0">Done blocks count. Tallest bar = ' + durTxt(max) + '.</p></div>';
    const n = rep.tracked;
    body += '<div class="cols2" style="margin-top:14px"><div class="card"><h3>By category</h3><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Category</th><th>Planned</th><th>Done</th><th>Per day</th></tr></thead><tbody>'
      + CFG.cats.filter(c => rep.planned[c.id] || rep.actual[c.id]).map(c => '<tr><td><span class="chip" style="--c:' + c.color + '"><i></i>' + esc(c.name) + '</span></td><td>' + hrs(rep.planned[c.id] || 0) + 'h</td><td>' + hrs(rep.actual[c.id] || 0) + 'h</td><td>' + durTxt((rep.actual[c.id] || 0) / n) + '</td></tr>').join('')
      + '</tbody></table></div><p class="hint" style="margin:8px 0 0">' + n + ' tracked days · plan kept ' + fmtVal(rep.keptPct, 'pct') + ' · pillars kept ' + fmtVal(rep.pillarPct, 'pct') + ' · closed ' + rep.closedDays + ' days</p></div>'
      + balanceBars(rep.balance, 'Free time: your mix vs target') + '</div>';
    const mx = Math.max(1, ...rep.missByHour);
    const hoursR = []; for (let h = 6; h < 24; h++) hoursR.push(h);
    body += '<div class="cols2" style="margin-top:14px"><div class="card"><h3>When blocks get skipped</h3><div class="heat">' + hoursR.map(h => '<div style="--v:' + (rep.missByHour[h] / mx) + '" title="' + pad(h) + ':00 · ' + rep.missByHour[h] + ' skipped">' + pad(h) + '</div>').join('') + '</div><p class="hint" style="margin:8px 0 0">Darker = more skipped blocks starting at that hour. Move hard things away from the dark hours.</p></div>'
      + '<div class="card"><h3>Streaks and wins</h3><div class="list">' + X.streaks(CFG, STORE, t).map(s => '<div class="li"><span class="chip">' + s.days + ' days</span><div class="t">' + esc(s.title) + '</div><span></span></div>').join('')
      + '<div class="li"><span class="chip">' + rep.dreamsDone.length + '</span><div><div class="t">Dreams done</div><div class="m">' + (rep.dreamsDone.map(i => esc(i.title)).join(', ') || 'none yet in this range') + '</div></div><span></span></div></div></div></div>';
  }
  body += sanyamHtml();
  return {
    title: 'Insights', sub: 'how you spend your time',
    actions: '<div class="seg">' + [['7', '7 days'], ['28', '4 weeks'], ['90', '3 months']].map(([k, l]) => '<button class="' + (r === k ? 'on' : '') + '" data-act="tab" data-g="insights" data-k="' + k + '">' + l + '</button>').join('') + '</div><button class="btn" data-act="csv">Export CSV</button>',
    body,
  };
}
function sanyamHtml() {
  let h = '<div class="card" style="margin-top:14px"><h3>Sanyam: why it breaks</h3>';
  if (!TF) return h + '<p class="hint" style="margin:0">Reads your sanyam slips from Tenfold (read-only). Sign in with the same Google account as Tenfold to see this.</p></div>';
  const an = X.sanyamAnalysis(CFG, STORE, TF, today());
  if (!an.length) return h + '<p class="hint" style="margin:0">No slip-type sanyam habits found in Tenfold.</p></div>';
  an.forEach(a => {
    h += '<div style="margin-top:10px"><div class="row"><b>' + esc(a.habit.name) + '</b><span class="chip">' + a.slips + ' slips total</span><span class="chip">' + a.slipDays + ' slip days tracked here</span><span class="chip">' + a.cleanDays + ' clean days tracked</span></div>';
    if (!a.enough) h += '<p class="hint">Needs at least 2 slip days and 3 clean days planned in DayBox to compare. Keep planning and marking your days.</p>';
    a.findings.forEach(f => { h += '<div class="find">' + esc(f) + '</div>'; });
    a.fixes.forEach(f => { h += '<div class="find fix">Fix: ' + esc(f) + '</div>'; });
    if (a.enough && !a.findings.length) h += '<p class="hint">No clear pattern yet between slip days and clean days.</p>';
    if (a.notes.length) h += '<div class="lbl" style="margin:10px 0 4px">Your notes on slip days</div>' + a.notes.slice(-5).reverse().map(n => '<div class="find"><b>' + fmtShort(n.date) + ':</b> ' + esc(n.note) + '</div>').join('');
    if (a.recent.length) h += '<p class="hint">Last slips: ' + a.recent.map(fmtShort).join(', ') + '</p>';
    h += '</div>';
  });
  return h + '<p class="hint">Saarthi (/saarthi in Claude Code) reads this too and gives you a deeper why plus schedule fixes.</p></div>';
}

/* ---------- Saarthi inbox ---------- */
function opLabel(o) { return o.label || (o.op && o.op.type) || 'change'; }
function viewSaarthi() {
  let body = '<div class="card"><h3>How Saarthi works</h3><ol class="small" style="margin:0;padding-left:18px"><li>On your laptop, open Claude Code and type <b>/saarthi</b> (or <b>/saarthi evening</b>, <b>/saarthi week</b>).</li><li>Saarthi reads your DayBox days plus your Tenfold goals and sanyam (read-only), and tells you what to change and why.</li><li>Its exact suggestions land here. Nothing changes until you accept. You can also say "ok 1,3" in Claude Code.</li><li>No API key and no extra money: it runs on your Claude plan.</li></ol></div>';
  if (!AUTH.signedIn) body += '<div class="empty" style="margin-top:14px">Sign in to receive Saarthi suggestions.<div style="margin-top:10px"><button class="btn pri" data-act="signin">Sign in with Google</button></div></div>';
  else if (!INBOX || !INBOX.ops) body += '<div class="empty" style="margin-top:14px">No suggestions yet. Run /saarthi in Claude Code.</div>';
  else {
    body += '<div class="card inbox" style="margin-top:14px"><div class="row" style="margin-bottom:8px"><h3 style="margin:0">' + esc(INBOX.title || 'Suggestions') + '</h3><span class="muted small">' + (INBOX.at ? new Date(INBOX.at).toLocaleString() : '') + '</span>' + (pendingOps() > 1 ? '<button class="btn sm pri" data-act="opall" style="margin-left:auto">Accept all</button>' : '') + '</div>'
      + (INBOX.summary ? '<p style="margin:0 0 10px">' + esc(INBOX.summary) + '</p>' : '')
      + (INBOX.tips && INBOX.tips.length ? '<ul style="margin:0 0 12px;padding-left:18px">' + INBOX.tips.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '')
      + INBOX.ops.map((o, i) => '<div class="op"><div><b>' + (i + 1) + '. ' + esc(opLabel(o)) + '</b>' + (o.why ? '<div class="muted small">' + esc(o.why) + '</div>' : '') + '</div><div class="row">' + (o.state === 'pending' || o.state === 'failed' ? (o.state === 'failed' ? '<span class="chip">failed</span>' : '') + '<button class="btn sm" data-act="oprej" data-i="' + i + '">Reject</button><button class="btn sm pri" data-act="opacc" data-i="' + i + '">Accept</button>' : '<span class="chip">' + esc(o.state) + '</span>') + '</div></div>').join('') + '</div>';
  }
  return { title: 'Saarthi', sub: 'your guide, you decide', body };
}
async function decideOp(i, accept) {
  const o = INBOX.ops[i]; if (!o || (o.state !== 'pending' && o.state !== 'failed')) return;
  if (accept) {
    const beforeCfg = clone(CFG);
    const res = X.applyOp(CFG, STORE, o.op, today());
    if (res.error && /^unknown op/.test(res.error)) { toast('This needs the newest DayBox. Reload the page, then tap Accept again.', 'Reload', () => location.reload(), 12000); return; }
    if (res.error) { o.state = 'failed'; toast('Could not apply: ' + res.error); }
    else {
      try { await DBXFB.pushHistory(String(Date.now()), fsSafe({ at: Date.now(), by: 'app', op: o.op, path: res.day ? 'days/' + res.day.date : 'meta/config', before: res.day ? (DAYS[res.day.date] || null) : beforeCfg })); } catch (e) {}
      if (res.day) { sortBlocks(res.day); saveDay(res.day); }
      if (res.cfg) saveCfg();
      o.state = 'accepted';
    }
  } else o.state = 'rejected';
  o.decidedAt = Date.now();
  try { await DBXFB.pushInbox(fsSafe(INBOX)); } catch (e) { toast('Could not save the decision: ' + e.message); }
  render();
}

/* ---------- settings ---------- */
function viewSettings() {
  const s = CFG.settings;
  const body = '<div class="cols2"><div>'
    + '<div class="card"><h3>Account and sync</h3>' + (AUTH.signedIn ? '<p style="margin:0 0 10px">Signed in as <b>' + esc(AUTH.email) + '</b>. Your data syncs across devices.</p><p class="small muted" style="margin:0 0 10px">User id (Saarthi uses it): <span class="mono">' + esc(AUTH.uid || '') + '</span></p><button class="btn" data-act="signout">Sign out</button>' : '<p style="margin:0 0 10px">You are using DayBox on this device only. Sign in with your Google account (the same one as Tenfold) to sync with your phone and use Saarthi.</p><button class="btn pri" data-act="signin">Sign in with Google</button><p class="hint">Sign-in works on the web address. Opening the file from your disk keeps data on this computer only.</p>') + '</div>'
    + '<div class="card"><h3>Your day</h3><div class="grid3">'
    + '<label class="field"><span>Grid starts</span><input type="time" step="900" data-s="dayStart" value="' + hm(s.dayStart) + '"></label>'
    + '<label class="field"><span>Bedtime</span><input type="time" step="300" data-s="bedtime" value="' + hm(s.bedtime) + '"></label>'
    + '<label class="field"><span>Grid ends</span><input type="time" step="900" data-s="dayEnd" value="' + hm(s.dayEnd) + '"></label></div>'
    + '<div class="grid2" style="margin-top:12px"><label class="field"><span>Free buffer</span><select data-s="buffer">' + [0.1, 0.15, 0.2, 0.25, 0.3].map(v => '<option value="' + v + '"' + (Math.abs(v - s.buffer) < 1e-9 ? ' selected' : '') + '>' + Math.round(v * 100) + '% stays free</option>').join('') + '</select></label>'
    + '<label class="field"><span>Theme</span><select data-s="theme">' + [['system', 'Same as device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => '<option value="' + v + '"' + (s.theme === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label></div>'
    + '<div class="row" style="margin-top:12px"><label class="check"><input type="checkbox" data-s="sound"' + (s.sound ? ' checked' : '') + '> Bell sound when a block starts and ends</label><button class="btn sm" data-act="notify">Allow pop-up alerts</button></div>'
    + '<p class="hint">Alerts only ring while DayBox is open in a tab (or on your phone home screen).</p></div>'
    + '<div class="card"><h3>Backup</h3><div class="row"><button class="btn" data-act="export">Export backup (JSON)</button><label class="btn">Import backup or routine<input type="file" accept=".json,application/json" id="impFile" hidden></label><button class="btn" data-act="csv">Export CSV</button></div><p class="hint">Import replaces templates, routine, bank and settings, and adds any days in the file. Use it once for <b>my-routine.json</b>.</p></div>'
    + '</div><div><div class="card"><h3>Categories</h3><div class="list">' + CFG.cats.map(c => '<div class="li" data-cat="' + c.id + '"><input type="color" value="' + c.color + '" data-f="color"><input type="text" value="' + esc(c.name) + '" data-f="name"><select data-f="group">' + [['fixed', 'Fixed'], ['free', 'Free time'], ['self', 'Self'], ['sleep', 'Sleep'], ['waste', 'Waste']].map(([v, l]) => '<option value="' + v + '"' + (c.group === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>').join('') + '</div><p class="hint">"Free time" categories count for your balance mix and suggestions.</p></div>'
    + '<div class="card"><h3>About</h3><p class="small" style="margin:0">DayBox v1 · Data: Firebase <span class="mono">planner/</span> (yours only). Tenfold is read, never written.</p></div></div></div>';
  return {
    title: 'Settings', body,
    after() {
      $$('[data-s]').forEach(el => {
        el.onchange = () => {
          const k = el.dataset.s;
          let v = el.type === 'checkbox' ? el.checked : el.type === 'time' ? toMin(el.value) : el.tagName === 'SELECT' && k === 'buffer' ? +el.value : el.value;
          CFG.settings[k] = v;
          if (k === 'dayEnd' && CFG.settings.dayEnd <= CFG.settings.dayStart + 120) CFG.settings.dayEnd = CFG.settings.dayStart + 120;
          if (k === 'bedtime') CFG.settings.bedtime = clamp(CFG.settings.bedtime, CFG.settings.dayStart + 60, CFG.settings.dayEnd);
          saveCfg(); render();
        };
      });
      $$('[data-cat]').forEach(li => { li.onchange = e => { const c = CFG.cats.find(x => x.id === li.dataset.cat); c[e.target.dataset.f] = e.target.value; saveCfg(); }; });
      $('#impFile').onchange = e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; };
    },
  };
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function exportJSON() { download('daybox-backup-' + today() + '.json', JSON.stringify({ type: 'daybox-backup', at: Date.now(), config: CFG, days: DAYS }, null, 1)); }
function exportCSV() {
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['date', 'start', 'end', 'minutes', 'title', 'category', 'status', 'unplanned', 'pillar', 'mit', 'note'].join(',')];
  Object.keys(DAYS).sort().forEach(k => DAYS[k].blocks.forEach(b => rows.push([k, hm(b.start), hm(b.start + b.dur), b.dur, q(b.title), q(catOf(CFG, b.cat).name), b.status, b.unplanned ? 1 : 0, b.pillar ? 1 : 0, b.mit ? 1 : 0, q(b.note)].join(','))));
  download('daybox-blocks-' + today() + '.csv', rows.join('\n'), 'text/csv');
}
function importFile(f) {
  const rd = new FileReader();
  rd.onload = () => {
    let o; try { o = JSON.parse(rd.result); } catch (e) { return toast('That file is not valid JSON.'); }
    if (!o || !o.config) return toast('Not a DayBox file (no "config" inside).');
    CFG = X.mergeConfig(o.config); saveCfg();
    const t = today();
    Object.keys(o.days || {}).forEach(k => { const d = o.days[k]; if (d && d.date) saveDay(d); });
    if (DAYS[t] && DAYS[t].blocks.every(b => b.status === 'planned' && (b.src === 'tpl' || b.src === 'rule'))) saveDay(X.buildDay(CFG, t));
    localStorage.setItem(LS_ONB, '1');
    render(); toast('Imported. Your routine is loaded.');
  };
  rd.readAsText(f);
}

/* ---------- print ---------- */
function printDay(date, blank) {
  const d = day(date), s = CFG.settings;
  const close = '<div class="sec"><b>Close-out</b><div>One line: what made today different from yesterday?</div><div class="ln"></div><div class="ln"></div>'
    + '<div style="margin-top:8px">Sanyam held? <span class="bx"></span>yes <span class="bx"></span>no · if no, what happened just before? Which gap?</div><div class="ln"></div><div class="ln"></div>'
    + '<div style="margin-top:8px">Tomorrow\'s MIT</div><div class="ln"></div></div>';
  let html = '<div class="pr"><div class="ph"><h1>' + fmtLong(date) + '</h1><span>DayBox' + (d.tpl && !blank ? ' · ' + esc(d.tpl.name) : '') + '</span></div>';
  if (blank) {
    html += '<table><thead><tr><th>Time</th><th>Plan</th><th>What really happened</th></tr></thead><tbody>';
    for (let m = Math.floor(s.dayStart / 30) * 30; m < s.bedtime + 30; m += 30) html += '<tr class="blank"><td class="tm">' + hm(m) + '</td><td></td><td></td></tr>';
    html += '</tbody></table>';
  } else {
    const blocks = d.blocks.filter(X.live).slice().sort((a, b) => a.start - b.start);
    const mits = blocks.filter(b => b.mit);
    if (mits.length) html += '<div class="sec" style="margin:0 0 8px"><b>MITs</b> ' + mits.map(b => '<span class="bx"></span>' + esc(b.title)).join(' &nbsp; ') + '</div>';
    html += '<table><thead><tr><th>Time</th><th>Plan</th><th style="width:36%">What really happened</th></tr></thead><tbody>'
      + blocks.map(b => { const att = X.attachObjs(b.attach); return '<tr><td class="tm">' + hm(b.start) + '–' + hm(b.start + b.dur) + '</td><td><span class="bx"></span><b>' + esc(b.title) + '</b> <span class="cat">' + esc(catOf(CFG, b.cat).name) + (b.pillar ? ' · pillar' : '') + (b.pillar && b.backup != null && !b.strict ? ' · backup ' + hm(b.backup) : '') + '</span>' + (att.length ? '<div class="att">' + att.map(a => '<span class="bx"></span>' + esc(a.t)).join(' &nbsp; ') + '</div>' : '') + '</td><td></td></tr>'; }).join('')
      + '</tbody></table>';
    const gs = X.gaps(d.blocks, s.dayStart, s.bedtime, 30);
    if (gs.length) html += '<div class="sec"><b>Free gaps</b> ' + gs.map(g => hm(g.start) + '–' + hm(g.end)).join(', ') + '. Fill them from the dream list, not the phone.</div>';
  }
  html += close + '</div>';
  $('#printArea').innerHTML = html;
  setTimeout(() => window.print(), 60);
}

/* ---------- bell + ticker ---------- */
let AC = null;
function beep(kind) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'end' ? [880, 660, 440] : [523, 784];
    notes.forEach((f, i) => {
      const o = AC.createOscillator(), g = AC.createGain(), t0 = AC.currentTime + i * 0.22;
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(g); g.connect(AC.destination); o.start(t0); o.stop(t0 + 0.55);
    });
  } catch (e) {}
}
function notify(msg) { try { if ('Notification' in window && Notification.permission === 'granted') new Notification('DayBox', { body: msg, icon: 'icon-192.png' }); } catch (e) {} }
let lastTick = nowMin(), lastDate = today();
function tick() {
  const t = today(), nm = nowMin();
  if (t !== lastDate) { lastDate = t; lastTick = 0; ensureToday(); if (CUR < t && VIEW === 'today') CUR = t; if (!DRAGGING && $('#ov').hidden) render(); return; }
  if (nm === lastTick) return;
  const d = DAYS[t];
  let crossed = false;
  if (d) d.blocks.filter(X.live).forEach(b => {
    const end = b.start + b.dur;
    if (lastTick < end && end <= nm) { crossed = true; if (b.status === 'planned' && b.cat !== 'sleep') ring('end', b, d); }
    else if (lastTick < b.start && b.start <= nm) { crossed = true; ring('start', b, d); }
  });
  if (crossed && VIEW === 'today' && CUR === t && !DRAGGING && $('#ov').hidden) { lastTick = nm; render(); return; }
  lastTick = nm;
  if (VIEW === 'today' && CUR === t && !DRAGGING && $('#ov').hidden) {
    const nb = $('#nowbar'); if (nb && d) { const st = nb.querySelector('.nb-stats'); const keep = st ? Array.from(st.children).slice(0, -1).map(x => x.outerHTML).join('') : ''; nb.outerHTML = nowBarHtml(d, keep); }
    const nl = $('.dg-now');
    if (nl) { if (Math.floor(nm / 60) !== +nl.closest('.dg-row').dataset.h) { render(); return; } nl.style.left = ((nm % 60) / 60 * 100) + '%'; }
    renderNav();
  }
}
function ring(kind, b, d) {
  if (CFG.settings.sound) beep(kind);
  const msg = kind === 'end' ? 'Time is up: ' + b.title + '. Stop mid-sentence, log it, move on.' : 'Now: ' + b.title + ' until ' + hm(b.start + b.dur);
  notify(msg);
  if (kind === 'end') toast(msg, 'Done', () => { b.status = 'done'; saveDay(d); render(); }, 12000); else toast(msg, null, null, 6000);
}
setInterval(tick, 15000);

/* ---------- actions ---------- */
const ACTS = {
  nav: a => setView(a.dataset.v),
  more: () => openSheet('<div class="sh-h"><h2>More</h2><button class="iconbtn" data-x aria-label="Close">×</button></div><div class="list">' + ['plan', 'routine', 'saarthi', 'settings'].map(id => { const v = VIEWS.find(x => x.id === id); return '<button class="nv" data-act="nav" data-v="' + id + '" style="padding:12px">' + ic(v.ic) + '<span>' + v.name + '</span>' + (id === 'saarthi' && pendingOps() ? '<span class="badge">' + pendingOps() + '</span>' : '') + '</button>'; }).join('') + '</div>'),
  prev: () => { CUR = addDays(CUR, -1); SCROLL_NOW = true; render(); },
  next: () => { CUR = addDays(CUR, 1); SCROLL_NOW = true; render(); },
  noop: () => {},
  dsgo: a => { CUR = a.dataset.d; SCROLL_NOW = true; render(); },
  dsweek: a => { CUR = addDays(CUR, +a.dataset.w); SCROLL_NOW = true; render(); },
  fitadd: fitAdd,
  fitdone: a => { const d = AG_DAY, x = d && (d.todo || []).find(y => y.id === a.dataset.id); if (!x) return; const b = blockOf(d, x); x.done = !(x.done || (b && b.status === 'done')); if (b) b.status = x.done ? 'done' : 'planned'; saveDay(d); render(); },
  fitdel: a => { const d = AG_DAY; if (!d) return; const before = clone(d); d.todo = (d.todo || []).filter(y => y.id !== a.dataset.id); saveDay(d); render(); toast('Removed from the list', 'Undo', () => { saveDay(before); render(); }); },
  sugacc: a => { const d = AG_DAY, sg = SUGS[+a.dataset.i]; if (!d || !sg) return; if ((d.todo || []).length >= FIT_MAX) return toast(FIT_MAX + ' is the limit for a day.'); d.todo = (d.todo || []).concat({ id: uid(), title: sg.item.title, min: sg.min, cat: sg.item.cat, done: false, by: 'saarthi' }); saveDay(d); render(); toast('Added to To fit. Place it when you are ready.'); },
  opfit: async a => {
    const i = +a.dataset.i, o = INBOX && INBOX.ops[i], d = AG_DAY; if (!o || !d) return;
    if (o.op.type !== 'addBlock') return decideOp(i, true);
    if ((d.todo || []).length >= FIT_MAX) return toast(FIT_MAX + ' is the limit for a day.');
    d.todo = (d.todo || []).concat({ id: uid(), title: o.op.block.title, min: o.op.block.dur || 30, cat: o.op.block.cat || 'goal', done: false, by: 'saarthi' });
    saveDay(d); o.state = 'accepted'; o.decidedAt = Date.now();
    try { await DBXFB.pushInbox(fsSafe(INBOX)); } catch (e) {}
    render(); toast('Added to To fit. Place it when you are ready.');
  },
  sughide: a => { const d = AG_DAY; if (!d) return; d.sugHide = (d.sugHide || []).concat(a.dataset.id); saveDay(d); render(); },
  tips: () => { TIPS_OPEN = !TIPS_OPEN; render(); },
  gotoday: () => { CUR = today(); SCROLL_NOW = true; render(); },
  wprev: () => { WEEK = addDays(WEEK, -7); render(); },
  wnext: () => { WEEK = addDays(WEEK, 7); render(); },
  wtoday: () => { WEEK = weekStart(today()); render(); },
  print: () => openSheet('<div class="sh-h"><h2>Print</h2><button class="iconbtn" data-x aria-label="Close">×</button></div><div class="form"><button class="btn pri" data-act="printplan">Print ' + fmtShort(CUR) + ' plan, with tick boxes</button><button class="btn" data-act="printblank">Print a blank day page to fill by hand</button></div>'),
  printplan: () => { closeSheet(); printDay(CUR, false); },
  printblank: () => { closeSheet(); printDay(CUR, true); },
  fill: () => doFill(CUR),
  close: () => openClose(VIEW === 'today' ? CUR : today()),
  whatnow: () => openWhatNow(VIEW === 'today' ? CUR : today()),
  bored: () => openWhatNow(today()),
  'done-cur': a => { const d = DAYS[today()]; const b = d && d.blocks.find(x => x.id === a.dataset.id); if (b) { b.status = 'done'; saveDay(d); render(); toast('Done: ' + b.title); } },
  backup: a => { const d = DAYS[CUR] || day(CUR); X.useBackup(d, a.dataset.id, +a.dataset.at); saveDay(d); render(); toast('Backup set at ' + hm(+a.dataset.at)); },
  dismiss: a => { const o = load(LS_DISMISS) || {}; (o[CUR] = o[CUR] || []).push(a.dataset.t); Object.keys(o).forEach(k => { if (k < addDays(today(), -7)) delete o[k]; }); put(LS_DISMISS, o); render(); },
  'track-empty': () => { const d = day(CUR); saveDay(d); render(); openBlock(DAYS[CUR], null, { start: 600, dur: 60 }); },
  'track-routine': () => { saveDay(X.buildDay(CFG, CUR)); render(); },
  onb: () => { localStorage.setItem(LS_ONB, '1'); render(); },
  signin: () => { if (window.DBXFB) DBXFB.signIn(); else toast('Sign-in is still loading. Try again in a second.'); },
  signout: () => { if (window.DBXFB) DBXFB.signOut(); },
  tab: a => { TAB[a.dataset.g] = a.dataset.k; render(); },
  item: a => openItem(a.dataset.id, a.dataset.kind),
  planit: a => planIt(a.dataset.id),
  dreamdone: a => { const it = CFG.items.find(i => i.id === a.dataset.id); it.done = !it.done; it.doneAt = it.done ? today() : null; saveCfg(); render(); if (it.done) toast('Dream done: ' + it.title + '. Nice.'); },
  boredsave: () => { CFG.boredom = $('#boredTxt').value.split('\n').map(x => x.trim()).filter(Boolean); saveCfg(); toast('Saved'); },
  planws: a => { PLAN_WS = a.dataset.ws; render(); },
  plansave: savePlan,
  rule: a => openRule(a.dataset.id),
  opacc: a => decideOp(+a.dataset.i, true),
  oprej: a => decideOp(+a.dataset.i, false),
  opall: async () => { for (let i = 0; i < INBOX.ops.length; i++) if (INBOX.ops[i].state === 'pending') await decideOp(i, true); },
  export: exportJSON, csv: exportCSV,
  notify: () => { if (!('Notification' in window)) return toast('This browser has no pop-up alerts.'); Notification.requestPermission().then(p => toast(p === 'granted' ? 'Alerts on.' : 'Alerts blocked. Allow them in the browser site settings.')); },
};
document.addEventListener('click', e => {
  if (DRAGGING) return;
  const a = e.target.closest('[data-act]'); if (!a) return;
  const fn = ACTS[a.dataset.act]; if (!fn) return;
  e.preventDefault(); fn(a, e);
});
addEventListener('resize', (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => { if (!DRAGGING && $('#ov').hidden) render(); }, 200); }; })());

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

if (MIGRATED) saveCfg();
ensureToday();
render();
})();

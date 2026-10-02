/* DayBox core: pure logic, no DOM. Loaded by index.html (classic script) and by test.js / saarthi.js (node vm). */
(function (root) {
'use strict';

/* ---------- time + date helpers ---------- */
const pad = n => String(n).padStart(2, '0');
const dkey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseKey = k => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dkey(d); };
const dow = k => parseKey(k).getDay();                       // 0 Sun .. 6 Sat
const weekStart = k => addDays(k, -((dow(k) + 6) % 7));       // week is Monday-Sunday
const hm = m => { m = Math.max(0, Math.round(m)); return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); };
const toMin = s => { const [h, mm] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (mm || 0); };
const durTxt = m => { m = Math.round(m); if (m < 60) return m + 'm'; const h = Math.floor(m / 60), r = m % 60; return r ? h + 'h ' + r + 'm' : h + 'h'; };
const hrs = m => (Math.round(m / 6) / 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clone = o => JSON.parse(JSON.stringify(o));
let _n = 0;
const uid = () => Date.now().toString(36) + (_n++).toString(36) + Math.random().toString(36).slice(2, 6);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const norm = s => String(s || '').trim().toLowerCase();
const zoneOf = m => m < 720 ? 'morning' : m < 1020 ? 'afternoon' : 'evening';

/* ---------- seeds (neutral: the repo is public; your real routine lives in my-routine.json) ---------- */
const SEED_CATS = [
  { id: 'pillar',  name: 'Pillar',  color: '#C2185B', group: 'fixed' },  // maroon: spirituality
  { id: 'office',  name: 'Office',  color: '#2F7BF5', group: 'fixed' },  // blue: trust, focus
  { id: 'admin',   name: 'Admin',   color: '#6E7A91', group: 'fixed' },  // grey: business
  { id: 'family',  name: 'Family',  color: '#F07A1A', group: 'free' },   // orange: warmth
  { id: 'goal',    name: 'Goal',    color: '#7B5CFA', group: 'free' },   // violet: ambition
  { id: 'hobby',   name: 'Hobby',   color: '#E6A100', group: 'free' },   // amber: joy
  { id: 'leisure', name: 'Leisure', color: '#09A6C9', group: 'free' },   // cyan: calm
  { id: 'health',  name: 'Health',  color: '#1FAE5B', group: 'free' },   // green: nature
  { id: 'self',    name: 'Self',    color: '#E54C9A', group: 'self' },   // pink: care
  { id: 'sleep',   name: 'Sleep',   color: '#4C5774', group: 'sleep' },  // slate
  { id: 'waster',  name: 'Waster',  color: '#EF4444', group: 'waste' },  // red: warning
];
// colours the first version shipped with; a category still on one of these gets the new palette
const OLD_SEED_COLORS = { pillar: ['#E08A1E', '#B4235A'], office: ['#3D6B99', '#3B7BE8'], admin: ['#7F8791', '#6B7A8F'], family: ['#2F9A62', '#F08A24', '#EA7317'], goal: ['#6C4FD0', '#7C5CFA'], hobby: ['#D4497A', '#E3A008', '#D99100'], leisure: ['#1C9DB0', '#0EA5C6', '#0B9CC0'], health: ['#8AA12A', '#22A55B'], self: ['#A0629E', '#E0559B'], sleep: ['#4B5876', '#55627A'], waster: ['#C7372F', '#E5484D'] };
const SHUTDOWN = ["Tomorrow's MIT written", 'Laptop closed', 'Phone on alerts only'];
const T = (start, dur, title, cat, x) => Object.assign({ id: uid(), start, dur, title, cat, attach: [] }, x || {});
function seedConfig() {
  const cfg = {
    v: 1, updated: 0,
    settings: {
      dayStart: 360, dayEnd: 1410, bedtime: 1350, buffer: 0.2, sound: true, theme: 'system',
      balance: { goal: 30, hobby: 15, leisure: 15, family: 25, health: 15 },
    },
    cats: clone(SEED_CATS),
    templates: [
      { id: 'tpl_work', name: 'Workday', version: 1, days: [1, 2, 3, 4, 5], blocks: [
        T(570, 90, 'Deep work', 'office', { checks: true, mit: true }),
        T(660, 120, 'Work chunks', 'office', { checks: true }),
        T(780, 45, 'Lunch + walk', 'health', { attach: ['10 min walk'] }),
        T(840, 120, 'Work chunks', 'office', { checks: true }),
        T(960, 45, 'Admin batch', 'admin'),
        T(1110, 15, 'Clock off', 'admin', { attach: SHUTDOWN.slice() }),
        T(1260, 20, 'Book first', 'self'),
        T(1350, 60, 'Lights out', 'sleep'),
      ] },
      { id: 'tpl_weekend', name: 'Weekend', version: 1, days: [0, 6], blocks: [
        T(450, 30, 'Morning walk', 'health'),
        T(600, 120, 'Family time', 'family'),
        T(1260, 20, 'Book first', 'self'),
        T(1350, 60, 'Lights out', 'sleep'),
      ] },
    ],
    rules: [
      { id: 'r_mp', title: 'Morning pillar', cat: 'pillar', start: 540, dur: 35, days: [0, 1, 2, 3, 4, 5, 6], from: '2000-01-01', to: null, pillar: true, backup: 1080, attach: [] },
      { id: 'r_ep', title: 'Evening pillar', cat: 'pillar', start: 1140, dur: 90, days: [0, 1, 2, 3, 4, 5, 6], from: '2000-01-01', to: null, pillar: true, strict: true, backup: null, attach: [] },
      { id: 'r_kids', title: 'Kids slot', cat: 'family', start: 1020, dur: 45, days: [0, 1, 2, 3, 4, 6], from: '2000-01-01', to: null, attach: [] },
      { id: 'r_little', title: 'Little adventure', cat: 'leisure', start: 1020, dur: 60, days: [5], from: '2000-01-01', to: null, attach: [] },
      { id: 'r_you', title: 'You-night', cat: 'self', start: 1260, dur: 60, days: [2], from: '2000-01-01', to: null, attach: [] },
    ],
    items: [
      { id: 'i_study', kind: 'regular', title: 'Study', cat: 'goal', min: 45, perWeek: 3, energy: 'deep', zone: 'morning' },
      { id: 'i_ex', kind: 'regular', title: 'Exercise', cat: 'health', min: 30, perWeek: 3, energy: 'light', zone: 'any' },
      { id: 'i_song', kind: 'dream', title: 'Learn a new song', cat: 'hobby', min: 30, energy: 'light', zone: 'evening', needs: '' },
      { id: 'i_novel', kind: 'dream', title: 'Read a novel', cat: 'leisure', min: 30, energy: 'light', zone: 'evening', needs: '' },
      { id: 'i_cook', kind: 'dream', title: 'Cook a new dish', cat: 'hobby', min: 60, energy: 'light', zone: 'afternoon', needs: 'ingredients' },
      { id: 'i_place', kind: 'dream', title: 'Visit a new place', cat: 'leisure', min: 180, energy: 'light', zone: 'any', needs: 'a free half day' },
      { id: 'i_friend', kind: 'dream', title: 'Call an old friend', cat: 'family', min: 20, energy: 'light', zone: 'any', needs: '' },
      { id: 'i_game', kind: 'dream', title: 'Board game with family', cat: 'family', min: 45, energy: 'light', zone: 'evening', needs: '' },
      { id: 'i_sketch', kind: 'dream', title: 'Sketch for fun', cat: 'hobby', min: 30, energy: 'light', zone: 'any', needs: '' },
    ],
    boredom: ['Breathing 6 min', 'Stretch 6 min', 'Walk 10 min', 'One page of study', 'Call someone'],
    tf: { on: true, goalMap: {} },
    weekPlans: {},
  };
  migrateTemplates(cfg);
  return cfg;
}

/* merge precedence: user values override seeds, never the reverse */
function mergeConfig(saved) {
  const s = seedConfig();
  if (!saved || typeof saved !== 'object') return s;
  const out = Object.assign({}, s, saved);
  out.settings = Object.assign({}, s.settings, saved.settings || {});
  out.settings.balance = Object.assign({}, (saved.settings && saved.settings.balance) ? {} : s.settings.balance, (saved.settings || {}).balance || {});
  out.tf = Object.assign({}, s.tf, saved.tf || {});
  out.tf.goalMap = Object.assign({}, (saved.tf || {}).goalMap || {});
  out.weekPlans = Object.assign({}, saved.weekPlans || {});
  const ids = new Set((out.cats || []).map(c => c.id));
  out.cats = (out.cats || []).slice();
  s.cats.forEach(c => { if (!ids.has(c.id)) out.cats.push(c); });
  out.cats = out.cats.map(c => (OLD_SEED_COLORS[c.id] || []).includes(String(c.color).toUpperCase()) ? Object.assign({}, c, { color: s.cats.find(x => x.id === c.id).color }) : c);
  ['templates', 'rules', 'items', 'boredom'].forEach(k => { if (!Array.isArray(out[k])) out[k] = s[k]; });
  migrateTemplates(out);
  return out;
}
/* Templates are gone: every template block becomes a recurring block on the same weekdays.
   Where a recurring block already sits inside it, the template block is split around it,
   and weekdays that end up with the same pieces share one recurring block. Runs once (templates get deleted:true). */
function migrateTemplates(cfg) {
  const live = (cfg.templates || []).filter(t => !t.deleted);
  if (!live.length) return false;
  const current = cfg.rules.filter(r => !r.deleted && !r.to);
  const groups = {};
  for (let d = 0; d < 7; d++) {
    const t = live.find(x => (x.days || []).includes(d)); // first template wins, same as before
    if (!t) continue;
    const dr = current.filter(r => (r.days || []).includes(d));
    (t.blocks || []).forEach(b => {
      if (dr.some(r => norm(r.title) === norm(b.title))) return;
      carve([{ id: 'x', start: b.start, dur: b.dur }], dr).forEach((p, i) => {
        const r = { title: b.title, cat: b.cat, start: p.start, dur: p.dur, pillar: !!b.pillar, backup: b.backup == null ? null : b.backup, strict: !!b.strict,
          checks: !!b.checks, mit: !!b.mit, attach: i ? [] : (b.attach || []).map(a => typeof a === 'string' ? a : a.t) };
        const key = JSON.stringify(r);
        (groups[key] = groups[key] || { r, days: [] }).days.push(d);
      });
    });
  }
  Object.values(groups).forEach(g => cfg.rules.push(Object.assign({ id: uid(), days: g.days, from: '2000-01-01', to: null }, g.r)));
  live.forEach(t => { t.deleted = true; t.migrated = true; });
  return true;
}

const catOf = (cfg, id) => cfg.cats.find(c => c.id === id) || { id, name: id || '?', color: '#888', group: 'fixed' };

/* ---------- materialising a day ---------- */
function activeRules(cfg, date) {
  const wd = dow(date);
  return cfg.rules.filter(r => !r.deleted && (r.days || []).includes(wd) && (!r.from || r.from <= date) && (!r.to || date <= r.to));
}
function templateFor(cfg, date) {
  const wd = dow(date);
  return cfg.templates.find(t => !t.deleted && (t.days || []).includes(wd)) || null;
}
function attachObjs(a) { return (a || []).map(x => typeof x === 'string' ? { t: x, done: false } : { t: x.t, done: !!x.done }); }
function blockFrom(src, extra) {
  return Object.assign({
    id: uid(), start: src.start, dur: src.dur, title: src.title, cat: src.cat,
    pillar: !!src.pillar, backup: src.backup == null ? null : src.backup, strict: !!src.strict,
    checks: !!src.checks, mit: !!src.mit, attach: attachObjs(src.attach), status: 'planned',
  }, extra || {});
}
const WEEK_SLOTS = {
  career:       { label: 'Career',           cat: 'office',  dur: 60 },
  relationship: { label: 'Relationship',     cat: 'family',  dur: 60 },
  self:         { label: 'Self',             cat: 'self',    dur: 60 },
  big:          { label: 'Big adventure',    cat: 'leisure', dur: 180 },
  little:       { label: 'Little adventure', cat: 'leisure', dur: 60 },
  younight:     { label: 'You-night',        cat: 'self',    dur: 60 },
};
function weekItemsFor(cfg, date) {
  const wp = (cfg.weekPlans || {})[weekStart(date)];
  if (!wp) return [];
  return Object.keys(WEEK_SLOTS).filter(k => wp[k] && wp[k].text && wp[k].date === date).map(k => {
    const v = wp[k], m = WEEK_SLOTS[k];
    return { wk: k, title: m.label + ': ' + v.text, cat: v.cat || m.cat, start: v.start, dur: v.dur || m.dur, attach: [] };
  });
}
/* ---------- no overlaps: helpers ---------- */
const overlaps = (a, b) => a.start < b.start + b.dur && b.start < a.start + a.dur;
function clashWith(blocks, cand, ignoreId) {
  return blocks.find(b => b.id !== ignoreId && b.status !== 'skipped' && b.status !== 'moved' && overlaps(b, cand)) || null;
}
/* cut the cutters' time out of the base blocks; leftovers under minLen are dropped */
function carve(base, cutters, minLen) {
  minLen = minLen == null ? 10 : minLen;
  const out = [];
  base.forEach(b => {
    let pieces = [[b.start, b.start + b.dur]];
    cutters.forEach(c => {
      const cs = c.start, ce = c.start + c.dur;
      pieces = pieces.reduce((acc, [s, e]) => { if (ce <= s || cs >= e) acc.push([s, e]); else { if (cs > s) acc.push([s, cs]); if (ce < e) acc.push([ce, e]); } return acc; }, []);
    });
    pieces.filter(([s, e]) => e - s >= minLen).forEach(([s, e], i) => out.push(Object.assign({}, b, { id: i ? uid() : b.id, start: s, dur: e - s, attach: i ? [] : b.attach })));
  });
  return out;
}
/* a new/edited recurring block trims the plain recurring blocks it lands on (from today); pillars never give way */
function makeRoom(cfg, rule, ignoreId, today) {
  const hits = cfg.rules.filter(r => r.id !== ignoreId && r.id !== rule.id && ruleLive(r, today) && (r.days || []).some(d => (rule.days || []).includes(d)) && overlaps(r, rule));
  const hard = hits.find(r => r.pillar);
  if (hard) return { error: '"' + rule.title + '" overlaps the pillar ' + hard.title + ' ' + hm(hard.start) + '-' + hm(hard.start + hard.dur) };
  hits.forEach(r => {
    const shared = r.days.filter(d => rule.days.includes(d)), rest = r.days.filter(d => !rule.days.includes(d));
    const base = clone(r); delete base.prev;
    if (r.from && r.from >= today) r.deleted = true; else r.to = addDays(today, -1);
    const mk = (days, start, dur, i) => cfg.rules.push(Object.assign(clone(base), { id: uid(), days, start, dur, from: today, to: null, prev: r.id, attach: i ? [] : base.attach }));
    if (rest.length) mk(rest, r.start, r.dur, 0);
    carve([{ id: 'x', start: r.start, dur: r.dur }], [rule]).forEach((p, i) => mk(shared, p.start, p.dur, i));
  });
  return { trimmed: hits.map(r => r.title) };
}
function ruleClash(cfg, rule, ignoreId, today) {
  return cfg.rules.find(r => r.id !== ignoreId && r.id !== rule.id && ruleLive(r, today) && (r.days || []).some(d => (rule.days || []).includes(d)) && overlaps(r, rule)) || null;
}

function buildDay(cfg, date) {
  const t = templateFor(cfg, date);
  const rules = activeRules(cfg, date);
  const week = weekItemsFor(cfg, date);
  const ruleTitles = new Set(rules.map(r => norm(r.title)));
  const weekKinds = new Set(week.map(w => w.wk));
  const blocks = [], fixed = [];
  rules.forEach(r => {
    // a Thursday-planned little adventure / you-night replaces the routine one that day
    if (weekKinds.has('little') && /little adventure/i.test(r.title)) return;
    if (weekKinds.has('younight') && /you-?night/i.test(r.title)) return;
    fixed.push(blockFrom(r, { src: 'rule', ruleId: r.id }));
  });
  week.forEach(w => fixed.push(blockFrom(w, { src: 'week', wk: w.wk })));
  // template blocks make room for recurring + Thursday-plan blocks, so nothing overlaps
  const tpl = t ? t.blocks.filter(b => !ruleTitles.has(norm(b.title))).map(b => blockFrom(b, { src: 'tpl' })) : [];
  blocks.push(...fixed, ...carve(tpl, fixed));
  blocks.sort((a, b) => a.start - b.start);
  return { date, updated: 0, virtual: true, tpl: t ? { id: t.id, version: t.version || 1, name: t.name } : null, locked: false, plan: null, blocks, close: null, slipNote: '' };
}
/* stored days are frozen; future untouched days are computed live; past untouched days are "not tracked" */
function getDay(store, cfg, date, today) {
  const s = store.days[date];
  if (s) return s;
  if (date >= today) return buildDay(cfg, date);
  return { date, updated: 0, virtual: true, untracked: true, tpl: null, locked: false, plan: null, blocks: [], close: null, slipNote: '' };
}
function planSnapshot(blocks) { return blocks.filter(b => !b.unplanned).map(b => ({ id: b.id, start: b.start, dur: b.dur, title: b.title, cat: b.cat, pillar: !!b.pillar })); }
function lockIfDue(day, today) {
  if (day.virtual || day.locked || day.date > today) return false;
  day.plan = planSnapshot(day.blocks); day.locked = true; return true;
}
/* rebuild an upcoming day from the current routine, keeping what you added or already marked */
function resetDay(cfg, day) {
  const fresh = buildDay(cfg, day.date);
  const keep = day.blocks.filter(b => b.src === 'manual' || b.src === 'bank' || b.src === 'backup' || b.unplanned || b.status !== 'planned');
  const kept = keep.filter(live);
  const blocks = carve(fresh.blocks.filter(f => !keep.some(k => norm(k.title) === norm(f.title))), kept).concat(keep).sort((a, b) => a.start - b.start);
  return Object.assign({}, day, { blocks, tpl: fresh.tpl });
}

/* ---------- routine edits: effective dating so old days never change ---------- */
function editRule(cfg, ruleId, patch, today) {
  const r = cfg.rules.find(x => x.id === ruleId);
  if (!r) return null;
  if (!r.from || r.from < today) {
    const nr = Object.assign(clone(r), patch, { id: uid(), from: today, to: null, prev: r.id });
    r.to = addDays(today, -1);
    cfg.rules.push(nr);
    return nr;
  }
  Object.assign(r, patch);
  return r;
}
function endRule(cfg, ruleId, today) {
  const r = cfg.rules.find(x => x.id === ruleId);
  if (!r) return;
  if (r.from && r.from >= today) r.deleted = true; else r.to = addDays(today, -1);
}
const ruleLive = (r, today) => !r.deleted && (!r.to || r.to >= today);

/* ---------- layout helpers ---------- */
function lanes(blocks) {
  const s = blocks.slice().sort((a, b) => a.start - b.start || b.dur - a.dur);
  const out = {}; let group = [], groupEnd = -1, laneEnds = [];
  const flush = () => { const n = laneEnds.length; group.forEach(id => { out[id].lanes = n; }); group = []; laneEnds = []; groupEnd = -1; };
  s.forEach(b => {
    if (group.length && b.start >= groupEnd) flush();
    let l = laneEnds.findIndex(e => e <= b.start);
    if (l < 0) { l = laneEnds.length; laneEnds.push(0); }
    laneEnds[l] = b.start + b.dur;
    out[b.id] = { lane: l, lanes: 1 };
    group.push(b.id);
    groupEnd = Math.max(groupEnd, b.start + b.dur);
  });
  if (group.length) flush();
  return out;
}
const live = b => b.status !== 'skipped' && b.status !== 'moved';
function intervals(blocks) {
  const iv = blocks.map(b => [b.start, b.start + b.dur]).sort((a, b) => a[0] - b[0]);
  const m = [];
  iv.forEach(([s, e]) => { if (m.length && s <= m[m.length - 1][1]) m[m.length - 1][1] = Math.max(m[m.length - 1][1], e); else m.push([s, e]); });
  return m;
}
function unionMin(blocks, from, to) {
  return intervals(blocks).reduce((a, [s, e]) => a + Math.max(0, Math.min(e, to) - Math.max(s, from)), 0);
}
function gaps(blocks, from, to, minLen) {
  minLen = minLen == null ? 15 : minLen;
  const out = []; let cur = from;
  intervals(blocks.filter(live)).forEach(([s, e]) => {
    if (e <= cur) return;
    if (s > cur) out.push({ start: cur, end: Math.min(s, to) });
    cur = Math.max(cur, e);
  });
  if (cur < to) out.push({ start: cur, end: to });
  return out.filter(g => g.end - g.start >= minLen);
}

/* ---------- bank + week counters ---------- */
function tfGoals(cfg, tf) {
  if (!tf || !Array.isArray(tf.goals)) return [];
  const SEC = { active: 'Live nugget', progress: 'This quarter', yearly: 'Yearly' };
  return tf.goals.filter(g => g && !g.deleted && !g.done && (SEC[g.sec] && (!g.parentId || g.sec === 'active'))).map(g => {
    const txt = (g.cat || '') + ' ' + (g.name || '');
    const guess = /health|fit|exercise|yoga|run|gym|walk|weight/i.test(txt) ? 'health' : /hobby|music|art|creat|paint|guitar|sing|draw|sketch/i.test(txt) ? 'hobby' : /family|kid|wife|parent/i.test(txt) ? 'family' : 'goal';
    const m = (cfg.tf.goalMap || {})[g.id] || {};
    return { id: g.id, name: g.name, tfCat: g.cat, sec: g.sec, secLabel: SEC[g.sec], cur: g.cur, target: g.target, unit: g.unit,
      on: m.on == null ? g.sec === 'active' : !!m.on, cat: m.cat || guess, min: m.min || 45, perWeek: m.perWeek || 3 };
  });
}
function candidates(cfg, tf) {
  const list = cfg.items.filter(i => !i.deleted && !(i.kind === 'dream' && i.done)).map(i => Object.assign({}, i));
  if (cfg.tf.on) tfGoals(cfg, tf).filter(g => g.on).forEach(g => list.push({ id: 'tf:' + g.id, kind: 'regular', title: g.name, cat: g.cat, min: g.min, perWeek: g.perWeek, energy: 'deep', zone: 'any', src: 'tenfold' }));
  return list;
}
const matches = (b, it) => b.itemId === it.id || norm(b.title) === norm(it.title);
function weekDays(store, cfg, date, today) { const ws = weekStart(date); return [0, 1, 2, 3, 4, 5, 6].map(i => getDay(store, cfg, addDays(ws, i), today)); }
function itemCount(days, it, statuses) {
  statuses = statuses || ['done', 'partial'];
  return days.reduce((a, d) => a + d.blocks.filter(b => matches(b, it) && statuses.includes(b.status)).length, 0);
}
function balanceState(cfg, days) {
  const free = cfg.cats.filter(c => c.group === 'free').map(c => c.id);
  const mins = {}; free.forEach(c => { mins[c] = 0; });
  days.forEach(d => d.blocks.forEach(b => { if (free.includes(b.cat) && live(b)) mins[b.cat] += b.dur; }));
  const total = Object.values(mins).reduce((a, b) => a + b, 0);
  const tgt = cfg.settings.balance || {};
  const tsum = free.reduce((a, c) => a + (+tgt[c] || 0), 0) || 1;
  const rows = free.map(c => { const share = total ? mins[c] / total : 0, target = (+tgt[c] || 0) / tsum; return { cat: c, min: mins[c], share, target, deficit: Math.max(0, target - share) }; });
  return { rows, total };
}

/* ---------- "What now?" ---------- */
function suggest(cfg, store, tf, date, gap, today, n) {
  n = n || 3;
  const days = weekDays(store, cfg, date, today);
  const def = {}; balanceState(cfg, days).rows.forEach(r => { def[r.cat] = r.deficit; });
  const free = gap.end - gap.start, zone = zoneOf(gap.start);
  const daysLeft = 7 - ((dow(date) + 6) % 7);
  const day = getDay(store, cfg, date, today);
  const scored = [];
  candidates(cfg, tf).forEach(it => {
    const need = it.min || 30;
    if (need > free && !(free >= 25 && free >= need * 0.5)) return;
    const fit = Math.max(15, Math.floor(Math.min(need, free) / 5) * 5);
    let s = 0; const why = [];
    if (it.kind === 'regular') {
      const done = itemCount(days, it), per = it.perWeek || 3, planned = itemCount(days, it, ['planned']), behind = Math.max(0, per - done - planned);
      if (behind === 0) { s += 0.2; why.push(done + '/' + per + ' this week, on track'); }
      else { s += 2 + 2 * behind / per + Math.min(1.5, behind / daysLeft * 1.5); why.push(done + '/' + per + ' this week'); }
      if (it.src === 'tenfold') why.push('Tenfold goal');
    } else { s += 1.5; why.push('from your dream list'); }
    const d = def[it.cat] || 0;
    if (d > 0.05) { s += d * 4; why.push(catOf(cfg, it.cat).name + ' is behind your balance'); }
    if (it.zone && it.zone !== 'any') { if (it.zone === zone) { s += 1; why.push('best in the ' + zone); } else s -= 0.5; } else s += 0.3;
    if (it.energy === 'deep') { if (zone === 'morning') s += 0.8; else if (zone === 'evening') s -= 1; } else s += 0.2;
    if (day.blocks.some(b => matches(b, it) && live(b))) return;  // one of each per day
    if (free >= need) s += 0.5; else why.push('short ' + fit + 'm version');
    scored.push({ item: it, score: s, min: fit, why: why.join(' · ') });
  });
  scored.sort((a, b) => b.score - a.score);
  const pick = [], seen = new Set();
  for (const c of scored) { if (pick.length >= n) break; if (!seen.has(c.item.cat)) { pick.push(c); seen.add(c.item.cat); } }
  for (const c of scored) { if (pick.length >= n) break; if (!pick.includes(c)) pick.push(c); }
  return pick;
}
/* first free slot at or after the backup time (and now) that fits the pillar */
// a pillar backup only yields to other pillars and to blocks already marked; plain planned blocks make room
const hardFor = (b, x) => x !== b && live(x) && (x.pillar || x.status !== 'planned');
function backupSlot(day, b, nowMin) {
  const from = Math.max(b.backup, Math.ceil(nowMin / 15) * 15);
  const g = gaps(day.blocks.filter(x => hardFor(b, x)), from, 1440, b.dur)[0];
  return g ? g.start : null;
}
function backupOffers(day, nowMin) {
  return day.blocks.filter(b => b.pillar && b.backup != null && !b.strict && (b.status === 'skipped' || (b.status === 'planned' && b.start + b.dur <= nowMin)))
    .filter(b => !day.blocks.some(x => x.of === b.id))
    .map(b => ({ block: b, at: backupSlot(day, b, nowMin) })).filter(o => o.at != null);
}
function useBackup(day, blockId, at) {
  const b = day.blocks.find(x => x.id === blockId);
  if (!b) return null;
  b.status = 'moved';
  const nb = Object.assign(clone(b), { id: uid(), start: at, src: 'backup', status: 'planned', backup: null, of: b.id });
  nb.attach = attachObjs(b.attach).map(a => ({ t: a.t, done: false }));
  const soft = day.blocks.filter(x => x !== b && live(x) && !hardFor(b, x));
  day.blocks = day.blocks.filter(x => !soft.includes(x)).concat(carve(soft, [nb]));
  day.blocks.push(nb);
  day.blocks.sort((a, c) => a.start - c.start);
  return nb;
}
/* fill free gaps with bank items, leaving the buffer free */
function fillDay(cfg, store, tf, date, today, nowMin) {
  const day = clone(getDay(store, cfg, date, today));
  const s = cfg.settings;
  // never fill before your day really starts (first planned block), nor in the past
  const first = day.blocks.filter(b => live(b) && b.cat !== 'sleep').reduce((m, b) => Math.min(m, b.start), 1440);
  let from = Math.max(s.dayStart, first < 1440 ? first : s.dayStart);
  if (date === today) from = Math.max(from, Math.ceil(nowMin / 15) * 15);
  const MAX_ADD = 5;
  const gs = gaps(day.blocks, from, s.bedtime, 30);
  let budget = gs.reduce((a, g) => a + g.end - g.start, 0) * (1 - s.buffer);
  const added = [];
  for (const g of gs) {
    let cur = g.start, placed = 0;
    while (g.end - cur >= 30 && budget >= 15 && placed < (g.end - g.start >= 120 ? 2 : 1) && added.length < MAX_ADD) {
      const tmp = { days: Object.assign({}, store.days, { [date]: day }) };
      const sug = suggest(cfg, tmp, tf, date, { start: cur, end: g.end }, today, 1)[0];
      if (!sug) break;
      const len = Math.max(15, Math.floor(Math.min(sug.min, budget, g.end - cur) / 15) * 15);
      const b = { id: uid(), start: cur, dur: len, title: sug.item.title, cat: sug.item.cat, itemId: sug.item.id, src: 'bank', auto: true, status: 'planned', attach: [], pillar: false, mit: false };
      day.blocks.push(b); added.push(b);
      budget -= len; cur += len; placed++;
      if (g.end - cur >= 45) cur += 15;
    }
  }
  day.blocks.sort((a, b) => a.start - b.start);
  return { day, added };
}

/* put a task into the first free slot that fits, from `from` until bedtime */
function placeBlock(cfg, day, item, from) {
  const need = item.min || 30;
  const g = gaps(day.blocks, from, cfg.settings.bedtime, need)[0];
  if (!g) return null;
  const b = { id: uid(), start: g.start, dur: need, title: item.title, cat: item.cat || 'goal', status: 'planned', attach: [], pillar: false, mit: false, src: item.src || 'todo' };
  if (item.itemId) b.itemId = item.itemId;
  day.blocks.push(b);
  day.blocks.sort((a, c) => a.start - c.start);
  return b;
}

/* ---------- principles ---------- */
function missedYesterday(store, cfg, date) {
  const y = store.days[addDays(date, -1)];
  const out = new Set();
  if (!y) return out;
  y.blocks.filter(b => b.pillar && b.status !== 'moved').forEach(b => {
    const ok = ['done', 'partial'].includes(b.status) || y.blocks.some(x => norm(x.title) === norm(b.title) && x !== b && ['done', 'partial'].includes(x.status));
    if (!ok) out.add(b.title);
  });
  return out;
}
function principleChecks(cfg, day, twice) {
  const out = [], s = cfg.settings;
  const act = day.blocks.filter(live);
  const awake = s.bedtime - s.dayStart;
  const booked = unionMin(act.filter(b => b.cat !== 'sleep'), s.dayStart, s.bedtime);
  const pct = awake > 0 ? booked / awake : 0;
  if (pct > 1 - s.buffer) out.push({ lvl: 'warn', t: 'Day is ' + Math.round(pct * 100) + '% booked. Leave ' + Math.round(s.buffer * 100) + '% free (things take longer than you think).' });
  if (!act.some(b => (b.cat === 'health' || /walk|exercise|yoga|run|gym|move|stretch|balayam/i.test(b.title)) && b.start < 900))
    out.push({ lvl: 'tip', t: 'Move by 3pm: put a 10-min walk before 15:00.' });
  const w = act.filter(b => b.cat === 'waster');
  if (w.some(b => b.start < 1140)) out.push({ lvl: 'warn', t: 'Waster box before 19:00. The app gets a box after 19:00, never in the middle of the day.' });
  const book = act.find(b => /book|read/i.test(b.title));
  if (w.length && book && w.some(b => b.start < book.start)) out.push({ lvl: 'tip', t: 'Effortful before effortless: put the book block before the waster box.' });
  if (!act.some(b => b.cat === 'sleep')) out.push({ lvl: 'tip', t: 'No bedtime block. Give yourself a bedtime.' });
  const mits = act.filter(b => b.mit).length;
  if (mits > 3) out.push({ lvl: 'warn', t: mits + ' MITs. Keep 1-3, or none of them is the most important.' });
  else if (mits === 0 && act.length) out.push({ lvl: 'tip', t: 'Star 1-3 MITs (most important tasks) for today.' });
  if (act.filter(b => b.cat === 'admin' && !/clock|shut/i.test(b.title)).length > 1) out.push({ lvl: 'tip', t: 'Batch the little things: merge admin into one block.' });
  if (twice && twice.size) out.push({ lvl: 'alert', t: 'Missed yesterday: ' + Array.from(twice).join(', ') + '. One miss is normal, do not miss twice.' });
  return { list: out, booked, pct };
}

/* ---------- reports ---------- */
const actualMin = b => b.status === 'done' ? b.dur : b.status === 'partial' ? Math.round(b.dur / 2) : 0;
function dayStats(cfg, day) {
  const st = { date: day.date, tracked: !day.virtual && day.blocks.length > 0, planned: {}, actual: {}, keepable: 0, kept: 0, skipped: [], waste: 0, pillarsPlanned: 0, pillarsKept: 0, closed: !!(day.close && day.close.at), unmarked: 0 };
  const plan = day.plan || day.blocks.filter(b => !b.unplanned);
  plan.forEach(b => { st.planned[b.cat] = (st.planned[b.cat] || 0) + b.dur; });
  day.blocks.forEach(b => {
    const a = actualMin(b);
    if (a) st.actual[b.cat] = (st.actual[b.cat] || 0) + a;
    if (b.status === 'skipped') st.skipped.push({ start: b.start, title: b.title, cat: b.cat });
    if (b.status === 'planned') st.unmarked++;
  });
  day.blocks.filter(b => !b.unplanned && b.cat !== 'sleep' && b.status !== 'moved').forEach(b => { st.keepable += b.dur; st.kept += actualMin(b); });
  const ptitles = new Set(day.blocks.filter(b => b.pillar).map(b => norm(b.title)));
  st.pillarsPlanned = ptitles.size;
  ptitles.forEach(t => { if (day.blocks.some(b => norm(b.title) === t && ['done', 'partial'].includes(b.status))) st.pillarsKept++; });
  st.waste = st.actual.waster || 0;
  return st;
}
function trackedDays(store, from, to) {
  return Object.keys(store.days).filter(k => k >= from && k <= to).sort().map(k => store.days[k]).filter(d => d && d.blocks && d.blocks.length);
}
function rangeReport(cfg, store, from, to) {
  const days = trackedDays(store, from, to);
  const stats = days.map(d => dayStats(cfg, d));
  const sum = (k) => { const o = {}; stats.forEach(s => Object.entries(s[k]).forEach(([c, m]) => { o[c] = (o[c] || 0) + m; })); return o; };
  const actual = sum('actual'), planned = sum('planned');
  const keepable = stats.reduce((a, s) => a + s.keepable, 0), kept = stats.reduce((a, s) => a + s.kept, 0);
  const pP = stats.reduce((a, s) => a + s.pillarsPlanned, 0), pK = stats.reduce((a, s) => a + s.pillarsKept, 0);
  const missByHour = new Array(24).fill(0);
  stats.forEach(s => s.skipped.forEach(b => { missByHour[Math.floor(b.start / 60) % 24]++; }));
  const free = cfg.cats.filter(c => c.group === 'free').map(c => c.id);
  const freeUsed = free.reduce((a, c) => a + (actual[c] || 0), 0);
  const tgt = cfg.settings.balance || {}, tsum = free.reduce((a, c) => a + (+tgt[c] || 0), 0) || 1;
  const balance = free.map(c => ({ cat: c, min: actual[c] || 0, share: freeUsed ? (actual[c] || 0) / freeUsed : 0, target: (+tgt[c] || 0) / tsum }));
  const dreamsDone = cfg.items.filter(i => i.kind === 'dream' && i.done && i.doneAt && i.doneAt >= from && i.doneAt <= to);
  const n = stats.length || 1;
  return { from, to, days: stats, tracked: stats.length, actual, planned, keptPct: keepable ? kept / keepable : null,
    pillarPct: pP ? pK / pP : null, wastePerDay: (actual.waster || 0) / n, freeUsedPerDay: freeUsed / n, missByHour, balance, dreamsDone,
    closedDays: stats.filter(s => s.closed).length };
}
function direction(cfg, store, today) {
  const a = rangeReport(cfg, store, addDays(today, -6), today);
  const b = rangeReport(cfg, store, addDays(today, -34), addDays(today, -7));
  const grow = r => ['goal', 'hobby', 'health'].reduce((x, c) => x + (r.actual[c] || 0), 0) / (r.tracked || 1);
  const ok = a.tracked >= 2 && b.tracked >= 2;
  const mk = (label, now, before, upGood, fmt) => {
    const delta = ok && now != null && before != null ? now - before : null;
    const dir = delta == null || Math.abs(delta) < 1e-9 ? 'flat' : delta > 0 ? 'up' : 'down';
    const good = delta == null ? null : (Math.abs(delta) < 0.02 * Math.max(1, Math.abs(before || 0)) ? null : (delta > 0) === upGood);
    return { label, now, before, dir, good, fmt, enough: ok };
  };
  return [
    mk('Waster per day', a.wastePerDay, b.wastePerDay, false, 'min'),
    mk('Goal + hobby + health per day', grow(a), grow(b), true, 'min'),
    mk('Plan kept', a.keptPct, b.keptPct, true, 'pct'),
    mk('Pillars kept', a.pillarPct, b.pillarPct, true, 'pct'),
  ];
}
function streaks(cfg, store, today) {
  const titles = Array.from(new Set(cfg.rules.filter(r => r.pillar && ruleLive(r, today)).map(r => r.title)));
  return titles.map(title => {
    let n = 0, d = today;
    for (let i = 0; i < 400; i++) {
      const day = store.days[d];
      const done = day && day.blocks.some(b => norm(b.title) === norm(title) && ['done', 'partial'].includes(b.status));
      if (done) n++;
      else if (d !== today) break;
      d = addDays(d, -1);
    }
    return { title, days: n };
  });
}

/* ---------- sanyam gap analysis (Tenfold data, read-only) ---------- */
function dayFeatures(cfg, d) {
  const s = cfg.settings;
  const act = d.blocks.filter(live);
  const gs = gaps(act, s.dayStart, s.bedtime, 15);
  const longest = gs.reduce((m, g) => (g.end - g.start > (m ? m.end - m.start : 0) ? g : m), null);
  const st = dayStats(cfg, d);
  return { date: d.date, dow: dow(d.date), emptyMin: gs.reduce((a, g) => a + g.end - g.start, 0), longest: longest ? longest.end - longest.start : 0,
    longestAt: longest ? longest.start : null, waste: st.waste, skipped: st.skipped.length,
    pillarRate: st.pillarsPlanned ? st.pillarsKept / st.pillarsPlanned : 1, closed: st.closed, note: d.slipNote || '' };
}
function sanyamHabits(tf) {
  if (!tf) return [];
  const cfg = tf.sanyamcfg || {};
  const hs = Object.keys(cfg).filter(k => cfg[k] && !cfg[k].deleted && (cfg[k].kind || 'slip') === 'slip').map(k => ({ id: k, name: cfg[k].name || 'Sanyam', start: cfg[k].start || '' }));
  if (!hs.some(h => h.id === 'main') && (tf.sanyam || []).some(r => !r.h)) hs.push({ id: 'main', name: 'Sanyam', start: '' });
  return hs;
}
function sanyamAnalysis(cfg, store, tf, today) {
  const rows = (tf && tf.sanyam) || [];
  const tracked = Object.values(store.days).filter(d => d && d.blocks && d.blocks.length && d.date <= today);
  return sanyamHabits(tf).map(h => {
    const slips = rows.filter(r => (r.h || 'main') === h.id && r.d).map(r => r.d).sort();
    const slipSet = new Set(slips);
    const feats = tracked.filter(d => !h.start || d.date >= h.start).map(d => Object.assign(dayFeatures(cfg, d), { slip: slipSet.has(d.date) }));
    const S = feats.filter(f => f.slip), C = feats.filter(f => !f.slip);
    const avg = (a, k) => a.length ? a.reduce((x, f) => x + (typeof f[k] === 'boolean' ? (f[k] ? 1 : 0) : f[k]), 0) / a.length : 0;
    const findings = [], fixes = [];
    if (S.length && C.length) {
      const e1 = avg(S, 'emptyMin'), e0 = avg(C, 'emptyMin');
      if (e1 - e0 >= 30 && e1 > e0 * 1.25) {
        findings.push('On slip days you had ' + durTxt(e1) + ' of empty, unplanned time. On clean days only ' + durTxt(e0) + '.');
        fixes.push('Plan the empty stretch. Put a dream item, a family block or a walk into it before the day starts.');
      }
      const g1 = avg(S, 'longest'), g0 = avg(C, 'longest');
      if (g1 - g0 >= 30) {
        const at = S.filter(f => f.longestAt != null).map(f => zoneOf(f.longestAt));
        const mode = at.sort((a, b) => at.filter(x => x === b).length - at.filter(x => x === a).length)[0];
        findings.push('The longest empty stretch on slip days was ' + durTxt(g1) + (mode ? ', mostly in the ' + mode : '') + ' (clean days: ' + durTxt(g0) + ').');
        fixes.push('No gap longer than 60 min' + (mode ? ' in the ' + mode : '') + '. Split it with something you enjoy.');
      }
      const w1 = avg(S, 'waste'), w0 = avg(C, 'waste');
      if (w1 - w0 >= 20) { findings.push('Waster time on slip days: ' + durTxt(w1) + ' vs ' + durTxt(w0) + ' on clean days.'); fixes.push('Box the app: one Waster block after 19:00 with an end time.'); }
      const k1 = avg(S, 'skipped'), k0 = avg(C, 'skipped');
      if (k1 - k0 >= 0.8) { findings.push('Slip days had more skipped blocks (' + k1.toFixed(1) + ' vs ' + k0.toFixed(1) + '). The day was already falling apart before the slip.'); fixes.push('After the first skip, use the backup slot the same day. Do not let the day go.'); }
      const p1 = avg(S, 'pillarRate'), p0 = avg(C, 'pillarRate');
      if (p0 - p1 >= 0.2) { findings.push('Pillars kept on slip days: ' + Math.round(p1 * 100) + '% vs ' + Math.round(p0 * 100) + '% on clean days.'); fixes.push('Protect the pillars first. A kept pillar makes the rest of the day hold.'); }
      const c1 = avg(S, 'closed'), c0 = avg(C, 'closed');
      if (c0 - c1 >= 0.25) { findings.push('You did the evening close-out on ' + Math.round(c0 * 100) + '% of clean days, only ' + Math.round(c1 * 100) + '% of slip days.'); fixes.push('Do the 2-min close-out every night, even on a bad day.'); }
    }
    const recent = slips.filter(d => d >= addDays(today, -90));
    if (recent.length >= 3) {
      const cnt = [0, 0, 0, 0, 0, 0, 0]; recent.forEach(d => cnt[dow(d)]++);
      const top = cnt.map((c, i) => [c, i]).sort((a, b) => b[0] - a[0]).slice(0, 2);
      const share = (top[0][0] + top[1][0]) / recent.length;
      if (share >= 0.5 && top[0][0] >= 2) {
        findings.push(Math.round(share * 100) + '% of slips in the last 90 days fell on ' + DOW[top[0][1]] + (top[1][0] ? ' and ' + DOW[top[1][1]] : '') + '.');
        fixes.push('Plan ' + DOW[top[0][1]] + ' first on Thursday. Give it a fixed shape, not an open day.');
      }
    }
    return { habit: h, slips: slips.length, recent: slips.slice(-5).reverse(), slipDays: S.length, cleanDays: C.length,
      findings, fixes, notes: S.filter(f => f.note).map(f => ({ date: f.date, note: f.note })),
      enough: S.length >= 2 && C.length >= 3 };
  });
}

/* ---------- sync merge (newer wins per doc) ---------- */
function mergeCloud(local, cloud) {
  const out = { config: local.config, days: Object.assign({}, local.days), pushConfig: false, pushDays: [], changed: false };
  // live snapshots send only what changed: a missing config / partial days must not trigger pushes
  if (cloud.config !== undefined) {
    const cu = (cloud.config && cloud.config.updated) || 0, lu = local.config.updated || 0;
    if (cloud.config && cu > lu) { out.config = cloud.config; out.changed = true; }
    else if (lu > cu) out.pushConfig = true;
  }
  const cd = cloud.days || {};
  Object.keys(cd).forEach(k => {
    const l = local.days[k], d = cd[k];
    if (!l || (d.updated || 0) > (l.updated || 0)) { out.days[k] = d; out.changed = true; }
    else if ((l.updated || 0) > (d.updated || 0)) out.pushDays.push(k);
  });
  if (!cloud.partial) Object.keys(local.days).forEach(k => { if (!cd[k]) out.pushDays.push(k); });
  return out;
}

/* ---------- Saarthi proposals: exact edits you approve ---------- */
/* op: {type:'addBlock', date, block} | {type:'moveBlock', date, title, start, dur?} | {type:'removeBlock', date, title}
       | {type:'editTemplateBlock', tpl, title, start?, dur?, cat?} | {type:'addItem', item} | {type:'setBalance', balance} */
function applyOp(cfg, store, op, today) {
  const dayFor = date => { const d = clone(getDay(store, cfg, date, today)); d.virtual = false; delete d.untracked; return d; };
  if (op.type === 'addBlock') {
    const d = dayFor(op.date);
    const nb = Object.assign({ id: uid(), status: 'planned', attach: [], src: 'saarthi' }, op.block);
    const cl = clashWith(d.blocks, nb);
    if (cl && nb.status !== 'skipped') return { error: '"' + nb.title + '" overlaps ' + cl.title + ' ' + hm(cl.start) + '-' + hm(cl.start + cl.dur) };
    d.blocks.push(nb);
    d.blocks.sort((a, b) => a.start - b.start);
    return { day: d };
  }
  if (op.type === 'moveBlock' || op.type === 'removeBlock') {
    const d = dayFor(op.date);
    const b = d.blocks.find(x => norm(x.title) === norm(op.title) && x.status === 'planned');
    if (!b) return { error: 'block "' + op.title + '" not found on ' + op.date };
    if (op.type === 'removeBlock') d.blocks = d.blocks.filter(x => x !== b);
    else {
      const cand = { start: op.start, dur: op.dur || b.dur };
      const cl = clashWith(d.blocks, cand, b.id);
      if (cl) return { error: '"' + b.title + '" at ' + hm(cand.start) + ' overlaps ' + cl.title };
      b.start = cand.start; b.dur = cand.dur; d.blocks.sort((a, c) => a.start - c.start);
    }
    return { day: d };
  }
  if (op.type === 'addTodo') {
    const d = dayFor(op.date), x = op.todo || {};
    if (!x.title) return { error: 'todo needs a title' };
    d.todo = (d.todo || []).concat({ id: uid(), title: x.title, min: x.min || 30, cat: x.cat || 'goal', done: false, by: 'saarthi' });
    return { day: d };
  }
  if (op.type === 'addRule') {
    const r = Object.assign({ id: uid(), from: today, to: null, attach: [], pillar: false, backup: null, strict: false }, op.rule || {});
    if (!r.title || r.start == null || !r.dur || !Array.isArray(r.days) || !r.days.length) return { error: 'recurring block needs title, start, dur, days' };
    const mr = makeRoom(cfg, r, null, today);
    if (mr.error) return mr;
    cfg.rules.push(r);
    return { cfg: true };
  }
  if (op.type === 'editRule') {
    const r = cfg.rules.find(x => ruleLive(x, today) && norm(x.title) === norm(op.title));
    if (!r) return { error: 'recurring block "' + op.title + '" not found' };
    const mr = makeRoom(cfg, Object.assign({}, r, op.patch || {}), r.id, today);
    if (mr.error) return mr;
    editRule(cfg, r.id, op.patch || {}, today);
    return { cfg: true };
  }
  if (op.type === 'addItem') { cfg.items.push(Object.assign({ id: uid(), kind: 'dream', min: 30, energy: 'light', zone: 'any' }, op.item)); return { cfg: true }; }
  if (op.type === 'setBalance') { cfg.settings.balance = Object.assign({}, op.balance); return { cfg: true }; }
  return { error: 'unknown op ' + op.type };
}

root.DBX = {
  pad, dkey, parseKey, addDays, dow, weekStart, hm, toMin, durTxt, hrs, clamp, clone, uid, DOW, norm, zoneOf,
  seedConfig, mergeConfig, migrateTemplates, catOf, SEED_CATS, SHUTDOWN, WEEK_SLOTS,
  overlaps, clashWith, carve, ruleClash, makeRoom, backupSlot,
  activeRules, templateFor, attachObjs, blockFrom, weekItemsFor, buildDay, getDay, planSnapshot, lockIfDue, resetDay,
  editRule, endRule, ruleLive, lanes, live, intervals, unionMin, gaps,
  tfGoals, candidates, matches, weekDays, itemCount, balanceState, suggest, backupOffers, useBackup, fillDay, placeBlock,
  missedYesterday, principleChecks, actualMin, dayStats, trackedDays, rangeReport, direction, streaks,
  dayFeatures, sanyamHabits, sanyamAnalysis, mergeCloud, applyOp,
};
})(typeof window !== 'undefined' ? window : globalThis);

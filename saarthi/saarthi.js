#!/usr/bin/env node
/* Saarthi bridge: Claude Code <-> DayBox data in Firestore.
   Reads planner/{uid}/... and Tenfold users/{uid} (read-only). Writes ONLY under planner/{uid}/ (assertPlannerPath).
   Key: ~/.daybox/saarthi-key.json (or DAYBOX_KEY). uid: auto-detected, or `node saarthi.js uid <id>`.

   node saarthi.js pull [--days N]        compact JSON for analysis (also saved to .cache/pull.json)
   node saarthi.js propose <file.json>    validate + send proposals to the DayBox inbox
   node saarthi.js apply <1,3|all>        apply approved proposals (backs up first)
   node saarthi.js reject <1,3|all>
   node saarthi.js learn "text"           remember something about the user
   node saarthi.js undo                   restore the last change Saarthi or the inbox made
   node saarthi.js status                 show the inbox
*/
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
let admin;
try { admin = require('firebase-admin'); } catch (e) { die('firebase-admin missing. Run: cd D:\\daybox\\saarthi; npm install'); }

const HOME = path.join(os.homedir(), '.daybox');
const KEY = process.env.DAYBOX_KEY || path.join(HOME, 'saarthi-key.json');
const CONF = path.join(HOME, 'saarthi.json');
const CACHE = path.join(__dirname, '.cache');

const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8'), ctx);
const X = ctx.DBX;

function die(m) { console.error(m); process.exit(1); }
if (!fs.existsSync(KEY)) die('Key not found at ' + KEY + '. Put the service account JSON there.');
admin.initializeApp({ credential: admin.credential.cert(require(KEY)) });
const db = admin.firestore();

const today = () => X.dkey(new Date());
const readConf = () => { try { return JSON.parse(fs.readFileSync(CONF, 'utf8')); } catch (e) { return {}; } };
const writeConf = o => { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(CONF, JSON.stringify(o, null, 1)); };

async function getUid() {
  if (process.env.DAYBOX_UID) return process.env.DAYBOX_UID;
  const c = readConf(); if (c.uid) return c.uid;
  const refs = await db.collection('planner').listDocuments();
  if (refs.length === 1) { writeConf(Object.assign(c, { uid: refs[0].id })); return refs[0].id; }
  die(refs.length ? 'Found ' + refs.length + ' users under planner/. Copy your user id from DayBox Settings, then: node saarthi.js uid <id>' : 'No DayBox data in Firebase yet. Sign in to DayBox once (Settings > Sign in) and change anything, then retry.');
}
function assertPlannerPath(uid, p) { if (!p.startsWith('planner/' + uid + '/')) throw new Error('BLOCKED: Saarthi only writes under planner/' + uid + '/, refused ' + p); }
const clean = o => JSON.parse(JSON.stringify(o));
async function write(uid, p, data) { assertPlannerPath(uid, p); await db.doc(p).set(clean(data)); }
async function remove(uid, p) { assertPlannerPath(uid, p); await db.doc(p).delete(); }

async function loadAll(uid) {
  const [c, ds, ib, mem, tf] = await Promise.all([
    db.doc('planner/' + uid + '/meta/config').get(),
    db.collection('planner/' + uid + '/days').get(),
    db.doc('planner/' + uid + '/meta/inbox').get(),
    db.doc('planner/' + uid + '/meta/saarthi').get(),
    db.doc('users/' + uid).get(),
  ]);
  const days = {}; ds.forEach(d => { days[d.id] = d.data(); });
  const t = tf.exists ? tf.data() : {};
  return {
    rawCfg: c.exists ? c.data() : null,
    cfg: X.mergeConfig(c.exists ? c.data() : null),
    store: { days },
    inbox: ib.exists ? ib.data() : null,
    memory: mem.exists ? mem.data() : { learnings: [] },
    tf: tf.exists ? { goals: t.goals || [], sanyam: t.sanyam || [], sanyamcfg: t.sanyamcfg || {} } : null,
  };
}

const blk = (cfg, b) => X.hm(b.start) + '-' + X.hm(b.start + b.dur) + ' ' + b.title + ' [' + X.catOf(cfg, b.cat).name + ']' + (b.pillar ? ' PILLAR' : '') + (b.mit ? ' MIT' : '') + (b.status && b.status !== 'planned' ? ' -> ' + b.status : '') + (b.unplanned ? ' (unplanned)' : '') + (b.note ? ' note: ' + b.note : '');
const pct = v => v == null ? null : Math.round(v * 100) + '%';
function brief(r) {
  const h = {}; Object.entries(r.actual).forEach(([k, v]) => { h[k] = X.hrs(v); });
  return { from: r.from, to: r.to, trackedDays: r.tracked, doneHoursByCat: h, planKept: pct(r.keptPct), pillarsKept: pct(r.pillarPct), wasterPerDay: X.durTxt(r.wastePerDay), freeTimeUsedPerDay: X.durTxt(r.freeUsedPerDay), closedDays: r.closedDays,
    skippedByHour: r.missByHour.map((n, i) => n ? X.pad(i) + ':00=' + n : null).filter(Boolean), balance: r.balance.map(b => b.cat + ' ' + pct(b.share) + ' (target ' + pct(b.target) + ')'), dreamsDone: r.dreamsDone.map(i => i.title) };
}

async function pull(nDays) {
  const uid = await getUid(), A = await loadAll(uid), t = today(), cfg = A.cfg, S = A.store;
  const slipDates = new Set(((A.tf && A.tf.sanyam) || []).map(r => r.d));
  const days = [];
  for (let i = nDays; i >= -7; i--) {
    const k = X.addDays(t, -i), d = X.getDay(S, cfg, k, t);
    days.push({ date: k, day: X.DOW[X.dow(k)], state: d.untracked ? 'not tracked' : d.virtual ? 'preview from routine' : 'saved', template: d.tpl && d.tpl.name,
      sanyamSlip: slipDates.has(k) || undefined, slipNote: d.slipNote || undefined, closeLine: d.close && d.close.line || undefined, tomorrowMit: d.close && d.close.mit || undefined,
      blocks: d.blocks.slice().sort((a, b) => a.start - b.start).map(b => blk(cfg, b)) });
  }
  const week = X.weekDays(S, cfg, t, t);
  const out = {
    now: { date: t, day: X.DOW[X.dow(t)], time: X.hm(new Date().getHours() * 60 + new Date().getMinutes()) },
    settings: { gridStart: X.hm(cfg.settings.dayStart), bedtime: X.hm(cfg.settings.bedtime), buffer: pct(cfg.settings.buffer), balanceTarget: cfg.settings.balance },
    categories: cfg.cats.map(c => c.id + '=' + c.name + ' (' + c.group + ')'),
    templates: cfg.templates.filter(x => !x.deleted).map(x => ({ id: x.id, name: x.name, days: x.days.map(d => X.DOW[d]), version: x.version, blocks: x.blocks.slice().sort((a, b) => a.start - b.start).map(b => blk(cfg, b)) })),
    recurring: cfg.rules.filter(r => X.ruleLive(r, t)).map(r => blk(cfg, r) + ' on ' + r.days.map(d => X.DOW[d]).join('/') + (r.backup != null ? ' backup ' + X.hm(r.backup) : '') + (r.strict ? ' strict' : '')),
    regular: X.candidates(cfg, A.tf).filter(i => i.kind === 'regular').map(i => ({ title: i.title, cat: i.cat, min: i.min, perWeek: i.perWeek, doneThisWeek: X.itemCount(week, i), plannedThisWeek: X.itemCount(week, i, ['planned']), src: i.src || 'bank' })),
    dreamsOpen: cfg.items.filter(i => i.kind === 'dream' && !i.done && !i.deleted).map(i => i.title + ' [' + i.cat + ', ' + i.min + 'm' + (i.zone !== 'any' ? ', ' + i.zone : '') + (i.needs ? ', needs ' + i.needs : '') + ']'),
    boredomList: cfg.boredom,
    thisWeekBalance: X.balanceState(cfg, week).rows.map(r => r.cat + ' ' + pct(r.share) + ' (target ' + pct(r.target) + ')'),
    report7: brief(X.rangeReport(cfg, S, X.addDays(t, -6), t)),
    report28: brief(X.rangeReport(cfg, S, X.addDays(t, -27), t)),
    direction: X.direction(cfg, S, t).map(m => m.label + ': ' + (m.fmt === 'pct' ? pct(m.now) : m.now == null ? '-' : X.durTxt(m.now)) + ' vs ' + (m.fmt === 'pct' ? pct(m.before) : m.before == null ? '-' : X.durTxt(m.before)) + (m.enough ? '' : ' (not enough data)')),
    pillarStreaks: X.streaks(cfg, S, t).map(s => s.title + ' ' + s.days + ' days'),
    sanyam: A.tf ? X.sanyamAnalysis(cfg, S, A.tf, t).map(a => ({ habit: a.habit.name, slips: a.slips, recent: a.recent, slipDaysTracked: a.slipDays, cleanDaysTracked: a.cleanDays, findings: a.findings, fixes: a.fixes, notes: a.notes })) : 'no Tenfold data',
    tenfoldGoals: A.tf ? X.tfGoals(cfg, A.tf).map(g => g.name + ' [' + g.secLabel + (g.target ? ', ' + (g.cur || 0) + '/' + g.target + ' ' + (g.unit || '') : '') + (g.on ? ', in planner' : ', off') + ']') : 'no Tenfold data',
    lastInbox: A.inbox ? { at: A.inbox.at && new Date(A.inbox.at).toISOString(), ops: (A.inbox.ops || []).map(o => o.id + ' ' + o.state + ': ' + o.label) } : null,
    learnings: (A.memory.learnings || []).slice(-30).map(l => l.text),
    days,
  };
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, 'pull.json'), JSON.stringify({ out, cfg: A.cfg, days: S.days, tf: A.tf }, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

function pickIds(inbox, arg) {
  const ops = (inbox && inbox.ops) || [];
  if (!arg || arg === 'all') return ops.filter(o => o.state === 'pending');
  const want = String(arg).split(',').map(s => s.trim()).filter(Boolean).map(s => /^\d+$/.test(s) ? 'o' + s : s);
  return ops.filter(o => want.includes(o.id));
}

async function propose(file) {
  const uid = await getUid(), A = await loadAll(uid), t = today();
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(p.ops)) die('proposal needs "ops": [...]');
  const cfg = X.clone(A.cfg), store = { days: X.clone(A.store.days) }, errs = [];
  p.ops.forEach((o, i) => {
    if (!o.op || !o.label) return errs.push((i + 1) + ': needs label + op');
    if (o.op.date && o.op.date < t) errs.push((i + 1) + ': date ' + o.op.date + ' is in the past');
    const r = X.applyOp(cfg, store, o.op, t);
    if (r.error) errs.push((i + 1) + ': ' + r.error);
    else if (r.day) store.days[r.day.date] = r.day;
  });
  if (errs.length) die('Proposal rejected:\n' + errs.join('\n'));
  if (A.inbox) await write(uid, 'planner/' + uid + '/history/inbox-' + Date.now(), { at: Date.now(), kind: 'inbox-archive', inbox: A.inbox });
  const inbox = { id: 'p' + Date.now(), at: Date.now(), by: 'saarthi', title: p.title || 'Saarthi suggestions', summary: p.summary || '', tips: p.tips || [],
    ops: p.ops.map((o, i) => ({ id: 'o' + (i + 1), label: o.label, why: o.why || '', op: o.op, state: 'pending' })) };
  await write(uid, 'planner/' + uid + '/meta/inbox', inbox);
  console.log('Sent ' + inbox.ops.length + ' suggestions to the DayBox inbox:');
  inbox.ops.forEach(o => console.log('  ' + o.id.slice(1) + '. ' + o.label));
}

async function decide(arg, accept) {
  const uid = await getUid(), A = await loadAll(uid), t = today();
  if (!A.inbox) die('Inbox is empty.');
  const sel = pickIds(A.inbox, arg).filter(o => o.state === 'pending');
  if (!sel.length) die('Nothing pending for: ' + (arg || 'all'));
  const cfg = A.cfg, store = A.store;
  let cfgDirty = false; const dayDirty = {};
  for (const o of sel) {
    if (!accept) { o.state = 'rejected'; o.decidedAt = Date.now(); continue; }
    const relPath = o.op.date ? 'days/' + o.op.date : 'meta/config';
    const before = o.op.date ? (store.days[o.op.date] || null) : A.rawCfg;
    const r = X.applyOp(cfg, store, o.op, t);
    if (r.error) { o.state = 'failed'; o.error = r.error; console.log('  ' + o.id + ' failed: ' + r.error); continue; }
    await write(uid, 'planner/' + uid + '/history/' + Date.now() + '-' + o.id, { at: Date.now(), by: 'saarthi', kind: 'apply', op: o.op, path: relPath, before });
    if (r.day) { r.day.updated = Date.now(); store.days[r.day.date] = r.day; dayDirty[r.day.date] = r.day; }
    if (r.cfg) cfgDirty = true;
    o.state = 'accepted'; o.decidedAt = Date.now();
  }
  for (const k of Object.keys(dayDirty)) await write(uid, 'planner/' + uid + '/days/' + k, dayDirty[k]);
  if (cfgDirty) { cfg.updated = Date.now(); await write(uid, 'planner/' + uid + '/meta/config', cfg); }
  await write(uid, 'planner/' + uid + '/meta/inbox', A.inbox);
  sel.forEach(o => console.log('  ' + o.id.slice(1) + '. ' + o.state + ': ' + o.label));
  if (accept) console.log('Open DayBox (or reload it) to see the changes.');
}

async function learn(text) {
  const uid = await getUid();
  const ref = db.doc('planner/' + uid + '/meta/saarthi');
  const s = await ref.get(); const m = s.exists ? s.data() : { learnings: [] };
  m.learnings = (m.learnings || []).concat({ at: Date.now(), text }).slice(-60);
  await write(uid, 'planner/' + uid + '/meta/saarthi', m);
  console.log('Remembered: ' + text);
}

async function undo() {
  const uid = await getUid();
  const hs = await db.collection('planner/' + uid + '/history').get();
  const list = []; hs.forEach(d => { const v = d.data(); if (v.kind === 'apply' || v.by === 'app') list.push({ id: d.id, v }); });
  list.sort((a, b) => (b.v.at || 0) - (a.v.at || 0));
  const h = list.find(x => !x.v.undone);
  if (!h) die('Nothing to undo.');
  const rel = h.v.path; if (!rel) die('That history entry has no path, cannot undo it automatically.');
  const full = 'planner/' + uid + '/' + rel;
  let before = h.v.before;
  if (before && before.config && rel === 'meta/config') before = before.config;
  if (before) { before.updated = Date.now(); await write(uid, full, before); } else await remove(uid, full);
  await write(uid, 'planner/' + uid + '/history/' + h.id, Object.assign({}, h.v, { undone: Date.now() }));
  console.log('Restored ' + rel + ' to before: ' + JSON.stringify(h.v.op));
}

async function status() {
  const uid = await getUid(); const s = await db.doc('planner/' + uid + '/meta/inbox').get();
  if (!s.exists) return console.log('Inbox empty.');
  const ib = s.data(); console.log(ib.title + ' (' + new Date(ib.at).toLocaleString() + ')');
  (ib.ops || []).forEach(o => console.log('  ' + o.id.slice(1) + '. [' + o.state + '] ' + o.label));
}

(async () => {
  const [cmd, a1] = process.argv.slice(2);
  try {
    if (cmd === 'pull') { const i = process.argv.indexOf('--days'); await pull(i > 0 ? +process.argv[i + 1] || 21 : 21); }
    else if (cmd === 'propose') { if (!a1) die('usage: propose <file.json>'); await propose(a1); }
    else if (cmd === 'apply') await decide(a1, true);
    else if (cmd === 'reject') await decide(a1, false);
    else if (cmd === 'learn') { const txt = process.argv.slice(3).join(' ').trim(); if (!txt) die('usage: learn "text"'); await learn(txt); }
    else if (cmd === 'undo') await undo();
    else if (cmd === 'status') await status();
    else if (cmd === 'uid') { if (!a1) die('usage: uid <id>'); writeConf(Object.assign(readConf(), { uid: a1 })); console.log('uid saved'); }
    else console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
  } catch (e) { die(e.message || String(e)); }
  process.exit(0);
})();

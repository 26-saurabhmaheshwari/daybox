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
   node saarthi.js ideas [date]           dry run of the +: print Claude's ideas, write nothing
   node saarthi.js watch                  stay on: the Saarthi + in DayBox asks Claude Code here (headless) for ideas,
                                          and the week plan runs each night at settings.weekPlanAt
   node saarthi.js tell "text" [--dry]    plain words -> exact changes in the inbox (what the app's Tell Saarthi box does)
   node saarthi.js week                   plan tomorrow..Sunday now (all of next week on a Sunday), to the inbox
*/
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), { spawn } = require('child_process');
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

const blk = (cfg, b) => X.hm(b.start) + '-' + X.hm(b.start + b.dur) + ' ' + b.title + ' [' + X.catOf(cfg, b.cat).name + ']' + (b.pillar ? ' PILLAR' : '') + (b.mit ? ' MIT' : '') + (b.status && b.status !== 'planned' ? ' -> ' + b.status : '') + (b.unplanned ? ' (unplanned)' : '') + (b.idea ? ' idea: ' + b.idea : '') + (b.note ? ' note: ' + b.note : '');
const pct = v => v == null ? null : Math.round(v * 100) + '%';
function brief(r, cfg) {
  const h = {}; Object.entries(r.actual).forEach(([k, v]) => { h[k] = X.hrs(v); });
  return { from: r.from, to: r.to, trackedDays: r.tracked, doneHoursByCat: h, planKept: pct(r.keptPct), pillarsKept: pct(r.pillarPct), wasterPerDay: X.durTxt(r.wastePerDay), freeTimeUsedPerDay: X.durTxt(r.freeUsedPerDay), closedDays: r.closedDays,
    skippedByHour: r.missByHour.map((n, i) => n ? X.pad(i) + ':00=' + n : null).filter(Boolean), balance: r.balance.map(b => b.cat + ' ' + pct(b.share) + ' (target ' + pct(b.target) + ')'), nonGoalsDone: r.funDone.map(x => x.title + ' ' + X.durTxt(x.min)), byType: Object.entries(r.byType).map(([t, v]) => X.typeOf(cfg, t).name + ' done ' + X.durTxt(v.actual) + ' of ' + X.durTxt(v.planned) + ' planned') };
}

async function pull(nDays) { console.log(JSON.stringify(await buildPull(nDays), null, 1)); }
async function buildPull(nDays) {
  const uid = await getUid(), A = await loadAll(uid), t = today(), cfg = A.cfg, S = A.store;
  const slipDates = new Set(((A.tf && A.tf.sanyam) || []).map(r => r.d));
  const days = [];
  for (let i = nDays; i >= -7; i--) {
    const k = X.addDays(t, -i), d = X.getDay(S, cfg, k, t);
    const nowM = new Date().getHours() * 60 + new Date().getMinutes();
    const freeGaps = k < t ? undefined : X.gaps(d.blocks.filter(X.live), k === t ? Math.max(cfg.settings.dayStart, Math.ceil(nowM / 15) * 15) : cfg.settings.dayStart, cfg.settings.bedtime, 30).map(g => X.hm(g.start) + '-' + X.hm(g.end));
    days.push({ freeGaps, date: k, day: X.DOW[X.dow(k)], state: d.untracked ? 'not tracked' : d.virtual ? 'preview from routine' : 'saved', template: d.tpl && d.tpl.name,
      sanyamSlip: slipDates.has(k) || undefined, slipNote: d.slipNote || undefined, closeLine: d.close && d.close.line || undefined, tomorrowMit: d.close && d.close.mit || undefined,
      toFit: d.todo && d.todo.length ? d.todo.map(x => x.title + ' (' + (x.min || 30) + 'm' + (x.done ? ', done' : x.placed ? ', placed' : ', not placed') + ')') : undefined,
      blocks: d.blocks.slice().sort((a, b) => a.start - b.start).map(b => blk(cfg, b)) });
  }
  const week = X.weekDays(S, cfg, t, t);
  // the picks lottery, same draw as the app (in memory: lines the app has not drawn yet)
  const pickCfg = X.clone(cfg); [X.weekStart(t), X.addDays(X.weekStart(t), 7)].forEach(ws => X.autoPicks(pickCfg, S, A.tf, ws, t));
  const out = {
    now: { date: t, day: X.DOW[X.dow(t)], time: X.hm(new Date().getHours() * 60 + new Date().getMinutes()) },
    settings: { gridStart: X.hm(cfg.settings.dayStart), bedtime: X.hm(cfg.settings.bedtime), buffer: pct(cfg.settings.buffer), balanceTarget: cfg.settings.balance },
    categories: X.liveCats(cfg).map(c => c.id + '=' + c.name + ' (' + X.typeOf(cfg, c.type).name + ')'),
    templates: cfg.templates.filter(x => !x.deleted).map(x => ({ id: x.id, name: x.name, days: x.days.map(d => X.DOW[d]), version: x.version, blocks: x.blocks.slice().sort((a, b) => a.start - b.start).map(b => blk(cfg, b)) })),
    recurring: cfg.rules.filter(r => X.ruleLive(r, t)).map(r => blk(cfg, r) + ' on ' + r.days.map(d => X.DOW[d]).join('/') + (r.backup != null ? ' backup ' + X.hm(r.backup) : '') + (r.strict ? ' strict' : '')),
    regular: X.candidates(cfg, A.tf).filter(i => i.kind === 'regular').map(i => ({ title: i.title, cat: i.cat, min: i.min, perWeek: i.perWeek, doneThisWeek: X.itemCount(week, i), plannedThisWeek: X.itemCount(week, i, ['planned']), src: i.src || 'bank' })),
    // non goals: no targets, nothing to tick off. You pick the length and keep them balanced (least done lately first)
    nonGoals: cfg.items.filter(i => !i.deleted && (i.kind === 'dream' || i.kind === 'fun')).map(i => { const ago = X.lastDone(S, i, t); return i.title + ' [' + (i.kind === 'dream' ? 'dream' : i.cat) + (i.kind === 'dream' ? ', ' + i.min + 'm' : '') + (i.needs ? ', needs ' + i.needs : '') + ', ' + X.durTxt(X.hoursDone(S, i)) + ' done' + (ago == null ? '' : ', last ' + ago + 'd ago') + ']'; }),
    boredomList: cfg.boredom,
    // this week's and next week's picks; no time = Saarthi has to place it
    weekPicks: [X.weekStart(t), X.addDays(X.weekStart(t), 7)].flatMap(ws => Object.entries((pickCfg.weekPlans || {})[ws] || {}).filter(([, v]) => v && v.text).map(([k, v]) => (X.WEEK_SLOTS[k] || { label: k }).label + ': ' + v.text + ' [week of ' + ws + ', ' + (v.date || 'any day') + ', ' + (v.start != null ? X.hm(v.start) : 'NO TIME, place it') + ', ' + v.dur + 'm' + (v.itemId ? ', itemId ' + v.itemId : '') + (v.cat ? ', cat ' + v.cat : '') + ']')),
    thisWeekBalance: X.balanceState(cfg, week).rows.map(r => r.cat + ' ' + pct(r.share) + ' (target ' + pct(r.target) + ')'),
    report7: brief(X.rangeReport(cfg, S, X.addDays(t, -6), t), cfg),
    report28: brief(X.rangeReport(cfg, S, X.addDays(t, -27), t), cfg),
    direction: X.direction(cfg, S, t).map(m => m.label + ': ' + (m.fmt === 'pct' ? pct(m.now) : m.now == null ? '-' : X.durTxt(m.now)) + ' vs ' + (m.fmt === 'pct' ? pct(m.before) : m.before == null ? '-' : X.durTxt(m.before)) + (m.enough ? '' : ' (not enough data)')),
    pillarStreaks: X.streaks(cfg, S, t).map(s => s.title + ' ' + s.days + ' days'),
    sanyam: A.tf ? X.sanyamAnalysis(cfg, S, A.tf, t).map(a => ({ habit: a.habit.name, slips: a.slips, recent: a.recent, slipDaysTracked: a.slipDays, cleanDaysTracked: a.cleanDays, findings: a.findings, fixes: a.fixes, notes: a.notes })) : 'no Tenfold data',
    tenfoldGoals: A.tf ? X.tfGoals(cfg, A.tf).map(g => g.name + (g.mini && g.mini !== g.name ? ' (mini: ' + g.mini + ')' : '') + ' [' + g.secLabel + (g.target ? ', ' + (g.cur || 0) + '/' + g.target + ' ' + (g.unit || '') : '') + (g.leftMin != null ? ', ' + X.durTxt(g.leftMin) + ' left' : '') + (g.via ? ', done inside the ' + g.via + ' routine block, never book it' : ', chunk ' + g.chunk + 'm') + ']') : 'no Tenfold data',
    lastInbox: A.inbox ? { at: A.inbox.at && new Date(A.inbox.at).toISOString(), ops: (A.inbox.ops || []).map(o => o.id + ' ' + o.state + ': ' + o.label) } : null,
    learnings: (A.memory.learnings || []).slice(-30).map(l => l.text),
    days,
  };
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, 'pull.json'), JSON.stringify({ out, cfg: A.cfg, days: S.days, tf: A.tf }, null, 1));
  return out;
}

function pickIds(inbox, arg) {
  const ops = (inbox && inbox.ops) || [];
  if (!arg || arg === 'all') return ops.filter(o => o.state === 'pending');
  const want = String(arg).split(',').map(s => s.trim()).filter(Boolean).map(s => /^\d+$/.test(s) ? 'o' + s : s);
  return ops.filter(o => want.includes(o.id));
}

async function propose(file) { await proposeObj(JSON.parse(fs.readFileSync(file, 'utf8'))); }
/* check ops in order on a copy; `today` may be edited (setStatus for what you did), other past days not */
function checkOps(A, ops, t) {
  const cfg = X.clone(A.cfg), store = { days: X.clone(A.store.days) }, errs = [], keep = [];
  ops.forEach((o, i) => {
    let e = null;
    if (!o.op || !o.label) e = 'needs label + op';
    else if (o.op.date && o.op.date < t) e = 'date ' + o.op.date + ' is in the past';
    else { const r = X.applyOp(cfg, store, o.op, t); if (r.error) e = r.error; else if (r.day) store.days[r.day.date] = r.day; }
    if (e) errs.push((i + 1) + ': ' + e); else keep.push(o);
  });
  return { errs, keep };
}
/* Suggestions are added to what is still waiting, grouped by request (inbox.reqs), never wiped.
   opt.kind: 'saarthi' (CLI) | 'ideas' (the +) | 'week' (a new week plan replaces the old waiting one) | 'tell' (Tell Saarthi, opt.text)
   opt.lenient: drop the ops that do not fit instead of rejecting the whole proposal. */
async function proposeObj(p, opt) {
  opt = typeof opt === 'object' && opt ? opt : { lenient: !!opt };
  const kind = opt.kind || 'saarthi';
  if (!p || !Array.isArray(p.ops)) throw new Error('proposal needs "ops": [...]');
  const uid = await getUid(), A = await loadAll(uid), t = today();
  const { errs, keep } = checkOps(A, p.ops, t);
  if (errs.length && !opt.lenient) throw new Error('Proposal rejected:\n' + errs.join('\n'));
  if (errs.length) console.log('Dropped ' + errs.length + ' that did not fit:\n  ' + errs.join('\n  '));
  if (!keep.length) throw new Error('Nothing in the proposal fitted' + (errs.length ? ': ' + errs[0] : ''));
  const old = A.inbox && Array.isArray(A.inbox.ops) ? A.inbox : null;
  if (old) await write(uid, 'planner/' + uid + '/history/inbox-' + Date.now(), { at: Date.now(), kind: 'inbox-archive', inbox: old });
  // the old inbox format had no groups: it becomes one
  const oldReqs = old ? (old.reqs || [{ id: 'r_old', kind: 'saarthi', at: old.at, title: old.title, summary: old.summary, tips: old.tips || [] }]) : [];
  const kindOf = o => (oldReqs.find(r => r.id === (o.req || 'r_old')) || {}).kind;
  const recent = Date.now() - 2 * 86400e3; // decided ones stay 2 days, so Saarthi sees what you rejected
  const prev = old ? old.ops.map(o => Object.assign({ req: 'r_old' }, o)).filter(o => o.state === 'pending' ? !(kind === 'week' && kindOf(o) === 'week') : (o.decidedAt || 0) > recent) : [];
  const req = { id: 'r' + Date.now(), kind, at: Date.now(), title: p.title || 'Saarthi suggestions', summary: p.summary || '', tips: p.tips || [] };
  LAST_REQ = req.id;
  if (opt.text) req.text = String(opt.text).slice(0, 500);
  const ops = prev.concat(keep.map(o => ({ label: o.label, why: o.why || '', op: o.op, state: 'pending', req: req.id }))).map((o, i) => Object.assign(o, { id: 'o' + (i + 1) }));
  const reqs = oldReqs.filter(r => ops.some(o => o.req === r.id)).concat(req);
  const inbox = { id: 'p' + Date.now(), at: Date.now(), by: 'saarthi', title: req.title, summary: req.summary, tips: req.tips, reqs, ops };
  await write(uid, 'planner/' + uid + '/meta/inbox', inbox);
  console.log('Sent ' + keep.length + ' suggestions to the DayBox inbox:');
  ops.filter(o => o.req === req.id).forEach(o => console.log('  ' + o.id.slice(1) + '. ' + o.label));
  return keep.length;
}

/* ---------- watch: DayBox's Saarthi + -> Claude Code (headless, your subscription) -> inbox ---------- */
// the claude CLI: CLAUDE_BIN, else on PATH, else the newest one bundled with the desktop app
function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const onPath = (process.env.PATH || '').split(path.delimiter).map(d => path.join(d, process.platform === 'win32' ? 'claude.exe' : 'claude')).find(f => fs.existsSync(f));
  if (onPath) return onPath;
  const roots = [path.join(process.env.APPDATA || '', 'Claude', 'claude-code')];
  try { fs.readdirSync(path.join(process.env.LOCALAPPDATA || '', 'Packages')).filter(n => n.startsWith('Claude_')).forEach(n => roots.push(path.join(process.env.LOCALAPPDATA, 'Packages', n, 'LocalCache', 'Roaming', 'Claude', 'claude-code'))); } catch (e) {}
  const found = [];
  roots.forEach(r => { try { fs.readdirSync(r).forEach(v => fs.readdirSync(path.join(r, v)).forEach(h => { const f = path.join(r, v, h, 'claude.exe'); if (fs.existsSync(f)) found.push({ f, t: fs.statSync(f).mtimeMs }); })); } catch (e) {} });
  found.sort((a, b) => b.t - a.t);
  if (!found.length) throw new Error('claude CLI not found. Set CLAUDE_BIN to its path.');
  return found[0].f;
}
// the coaching rules + op format live in the /saarthi command (sections 3 and 4): one source of truth
// real life: an activity has to be possible when you put it there
const POSSIBLE = 'Only put an activity where it can really happen: outdoor things (walks, gardening, bird watching, outdoor play, picnics) in daylight; the kids only when they are home and awake; partner time when the partner is free (evenings, weekends); calls to parents not late at night; temples, shops, melas and outings in their opening hours; long or far things (drives, picnics, new places, relatives) on weekends or free days; deep work (study, nuggets) in the hours the user keeps, never right after a long event; quiet things (journaling, phone-off) in the evening. Respect an item\'s days / zone / from-to when given. Never on top of work (Office) or pillars.';
function saarthiRules() {
  try { const m = fs.readFileSync(path.join(os.homedir(), '.claude', 'commands', 'saarthi.md'), 'utf8'); const a = m.indexOf('## 3.'), b = m.indexOf('## 5.'); if (a > 0 && b > a) return m.slice(a, b); } catch (e) {}
  return 'Op types: addTodo {date, todo:{title,min,cat}} · addBlock {date, block:{start,dur,title,cat}} (start/dur in minutes from midnight).';
}
let LAST_REQ = null; // the request id proposeObj made last, for auto-apply
async function applyReq(reqId) {
  const s = await db.doc('planner/' + (await getUid()) + '/meta/inbox').get(), ib = s.exists ? s.data() : null;
  const ids = ((ib && ib.ops) || []).filter(o => o.req === reqId && o.state === 'pending').map(o => o.id);
  if (ids.length) await decide(ids.join(','), true);
  return ids.length;
}
function askClaude(prompt) {
  return new Promise((res, rej) => {
    // no tools, no user hooks/settings, nothing saved: one prompt in, one JSON out
    const ch = spawn(findClaude(), ['-p', '--model', 'sonnet', '--tools', '', '--setting-sources', 'project,local', '--no-session-persistence', '--output-format', 'text'], { cwd: os.tmpdir(), windowsHide: true });
    let out = '', err = '';
    const kill = setTimeout(() => { ch.kill(); rej(new Error('Claude took over 4 min')); }, 240e3);
    ch.stdout.on('data', d => { out += d; }); ch.stderr.on('data', d => { err += d; });
    ch.on('error', e => { clearTimeout(kill); rej(e); });
    ch.on('close', code => {
      clearTimeout(kill);
      if (code) return rej(new Error((err || out).trim().split('\n').pop() || 'claude exit ' + code));
      const a = out.indexOf('{'), b = out.lastIndexOf('}');
      try { res(JSON.parse(out.slice(a, b + 1))); } catch (e) { rej(new Error('Claude did not reply with JSON')); }
    });
    ch.stdin.end(prompt);
  });
}
function fitPrompt(out, ask) {
  const n = Math.max(1, Math.min(5, ask.slots || 3));
  return ['You are Saarthi, the DayBox time coach. The user tapped + in the Saarthi part of DayBox to get ideas for ' + ask.date + '. The time now is in DATA.now.',
    saarthiRules(),
    POSSIBLE,
    'Task: propose 1 to ' + n + ' ideas for ' + ask.date + ' that fit its free gaps (from now on, if it is today). Use addTodo (it lands in the To fit list and the user places it), or addBlock only with an exact free start that clashes with nothing.',
    'label = the activity name only, max 4 words. why = one short line with a number from the data. Skip anything already in that day\'s toFit and anything rejected in lastInbox or learnings.',
    'Reply with ONLY the proposal JSON object ({"title","summary","tips","ops"}). No prose, no code fence. Do not use tools.',
    'DATA:\n' + JSON.stringify(out)].join('\n\n');
}
/* the week plan: from tomorrow to Sunday; run on a Sunday it is all of next week */
function weekRange(t) { const from = X.addDays(t, 1); return { from, to: X.addDays(X.weekStart(from), 6) }; }
function weekPrompt(out, r) {
  return ['You are Saarthi, the DayBox time coach. Plan the user\'s days ' + r.from + ' to ' + r.to + ' (a week plan, made the night before). The time now is in DATA.now.',
    saarthiRules(),
    'Task: look at how this week is going (DATA.days blocks and statuses, regular doneThisWeek vs perWeek, tenfoldGoals minutes left and chunk, thisWeekBalance vs balanceTarget, nonGoals least done lately, weekPlans, skippedByHour, learnings) and fill the free time of each day from ' + r.from + ' to ' + r.to + '.',
    'Rules for this week plan (they replace the max 5 ops rule): only addBlock, up to 3 per day, 15 in total. Each block sits fully inside that day\'s freeGaps and clashes with nothing (also not with your other blocks that day). Leave at least ' + out.settings.buffer + ' of each day free. Deep work (goals, nuggets) in the hours the user keeps (see skippedByHour), light things in the evening. Behind goals and nuggets first, then the balance, then non goals. A nugget uses its chunk minutes; non goals 20-60m. Never touch pillars or recurring blocks. Set mit:true on one block per day only if that day has no MIT yet.',
    POSSIBLE,
    'weekPicks marked NO TIME come first: place each one in this range (on its day if it has one), with its minutes, title = its text, block.itemId = its itemId, block.cat = its cat. Skip a pick that is already in the blocks of that week.',
    'label = "Day: activity HH:MM" (e.g. "Tue: Spanish 07:30"), max 5 words. why = one short line with a number from the data. summary = one line on how the week is going and what this plan fixes.',
    'Reply with ONLY the proposal JSON object ({"title","summary","tips","ops"}). No prose, no code fence. Do not use tools.',
    'DATA:\n' + JSON.stringify(out)].join('\n\n');
}
async function planWeek(dry) {
  const t = today(), r = weekRange(t);
  const p = await askClaude(weekPrompt(await buildPull(14), r));
  p.title = 'Week plan ' + r.from.slice(5) + ' to ' + r.to.slice(5);
  (p.ops || []).forEach(o => { if (o.op && (o.op.type !== 'addBlock' || !o.op.date || o.op.date < r.from || o.op.date > r.to)) o.op = null; });
  if (!dry) {
    const n = await proposeObj(p, { lenient: true, kind: 'week' });
    const c = await db.doc('planner/' + (await getUid()) + '/meta/config').get();
    if (X.mergeConfig(c.exists ? c.data() : null).settings.weekPlanAuto !== false) { await applyReq(LAST_REQ); console.log('Applied the week plan (Settings: fill free time by itself).'); }
    return n;
  }
  // dry run: check every op against a copy, write nothing
  const A = await loadAll(await getUid()), cfg = X.clone(A.cfg), store = { days: X.clone(A.store.days) };
  console.log(p.title + '\n' + (p.summary || ''));
  (p.ops || []).forEach((o, i) => { const res = o.op ? X.applyOp(cfg, store, o.op, t) : { error: 'not an addBlock in range' }; if (res.day) store.days[res.day.date] = res.day; console.log('  ' + (i + 1) + '. ' + (res.error ? 'DROP ' : 'ok   ') + o.label + (res.error ? ' (' + res.error + ')' : '') + ' - ' + (o.why || '')); });
  return 0;
}
/* Tell Saarthi: plain words from the app ("tomorrow busy till 5, walk 6-9") -> exact changes, waiting for one tap */
function tellPrompt(out, text, date, errs) {
  return ['You are Saarthi, the DayBox time coach. The user typed a request in DayBox. Turn it into exact changes. The time now is in DATA.now; the day the user was looking at is ' + date + '.',
    saarthiRules(),
    'Request: """' + String(text).slice(0, 500) + '"""',
    'How to read it: "today", "tomorrow", weekday names are relative to DATA.now. Do exactly what was asked; where the user leaves a choice to you ("self block, you decide"), pick from the data (non goals least done lately, To fit, regular behind) and say why. Remove or move whatever the new plan overlaps. Pillars and strict blocks: change them only when the request needs it, and say so in why.',
    POSSIBLE,
    'Ops are applied in order, each on the result of the ones before. Use only: addBlock {date, block:{start,dur,title,cat,status?,unplanned?}} · moveBlock {date,title,at?,start,dur?} · removeBlock {date,title,at?} · setStatus {date,title,at?,status: done|partial|skipped|planned} · addTodo {date,todo:{title,min,cat}} · removeTodo {date,title} · addItem {item:{kind: regular|dream|fun, title, cat, min?}} · editItem {title, patch:{title?,cat?,min?}} · removeItem {title} (bank lists: hobbies and leisure are kind fun). Minutes from midnight. at = the block\'s current start, needed when two blocks share a title. Only today and later; for things already done today use status done (+ unplanned:true for new ones). Categories: ids from DATA.categories. Day changes are for the days asked only, never the routine; bank ops change your lists.',
    'label = "Day: what HH:MM" (e.g. "Sat: Walk 18:00-21:00"), max 6 words. why = one short line. summary = one line telling the user what you did, in plain words.',
    errs ? 'Your last answer failed these checks, fix them:\n' + errs : '',
    'Reply with ONLY the proposal JSON object ({"title","summary","ops"}). No prose, no code fence. Do not use tools.',
    'DATA:\n' + JSON.stringify(out)].filter(Boolean).join('\n\n');
}
async function tell(text, date, dry) {
  if (!String(text || '').trim()) throw new Error('Nothing to do: the request is empty');
  date = date || today();
  const out = await buildPull(7);
  let p = await askClaude(tellPrompt(out, text, date)), errs = [];
  for (let i = 0; i < 2; i++) { // one retry with the errors
    const A = await loadAll(await getUid());
    errs = checkOps(A, p.ops || [], today()).errs;
    if (!errs.length || i) break;
    p = await askClaude(tellPrompt(out, text, date, errs.join('\n')));
  }
  if (errs.length) throw new Error('Saarthi could not make it fit: ' + errs[0]);
  p.title = p.title || 'Your request';
  if (dry) { console.log(p.summary + '\n' + (p.ops || []).map((o, i) => '  ' + (i + 1) + '. ' + o.label + ' - ' + (o.why || '')).join('\n')); return 0; }
  return proposeObj(p, { kind: 'tell', text });
}
/* "Move to next good slot" from the block editor: Claude picks the next slot where it can really happen, and it is applied */
function movePrompt(out, a, errs) {
  return ['You are Saarthi, the DayBox time coach. The user tapped "Move to next good slot" on a block. Move it to the best next slot. The time now is in DATA.now.',
    'Block: "' + a.title + '" on ' + a.date + ' at ' + X.hm(a.start) + ', ' + a.dur + ' min' + (a.cat ? ', category ' + a.cat : '') + '.',
    POSSIBLE,
    'Pick the earliest slot after it where it is free (see DATA.days freeGaps) AND possible; later the same day first, else the next days (up to 7). Keep its length unless only a little shorter fits (never under 2/3).',
    'Same day: one op moveBlock {date, title, at: its current start, start}. Another day: two ops, removeBlock {date, title, at} then addBlock {date: new day, block:{start, dur, title, cat}}. Minutes from midnight.',
    'label = "Move: title Day HH:MM", why = one short line on why that slot (and why not earlier ones). summary = one line for the user.',
    errs ? 'Your last answer failed these checks, fix them:\n' + errs : '',
    'Reply with ONLY the proposal JSON object ({"title","summary","ops"}). No prose, no code fence. Do not use tools.',
    'DATA:\n' + JSON.stringify(out)].filter(Boolean).join('\n\n');
}
async function moveSmart(a) {
  const out = await buildPull(3);
  let p = await askClaude(movePrompt(out, a)), errs = [];
  for (let i = 0; i < 2; i++) {
    errs = checkOps(await loadAll(await getUid()), p.ops || [], today()).errs;
    if (!errs.length || i) break;
    p = await askClaude(movePrompt(out, a, errs.join('\n')));
  }
  if (errs.length) throw new Error('No good slot found: ' + errs[0]);
  p.title = p.title || 'Move ' + a.title;
  await proposeObj(p, { kind: 'move' });
  return applyReq(LAST_REQ);
}
async function watch() {
  const uid = await getUid(), ref = 'planner/' + uid + '/meta/ask';
  console.log('Saarthi watcher on (' + findClaude() + '). Tap + in DayBox -> Saarthi. Ctrl+C to stop.');
  // heartbeat: DayBox shows the "Ask Saarthi" + only while this runs
  const beat = () => write(uid, 'planner/' + uid + '/meta/watcher', { at: Date.now() }).catch(e => console.error('heartbeat: ' + e.message));
  beat(); setInterval(beat, 60e3);
  // nightly week plan at settings.weekPlanAt (minutes, null = off), once a day, only while this PC runs the watcher
  const nightly = async () => {
    try {
      const c = await db.doc('planner/' + uid + '/meta/config').get(), at = X.mergeConfig(c.exists ? c.data() : null).settings.weekPlanAt;
      const nowM = new Date().getHours() * 60 + new Date().getMinutes(), t = today();
      if (at == null || nowM < at || nowM > at + 120) return;
      const m = await db.doc('planner/' + uid + '/meta/weekplan').get();
      if (m.exists && m.data().date === t) return;
      await write(uid, 'planner/' + uid + '/meta/weekplan', { date: t, at: Date.now() });
      await write(uid, ref, { at: Date.now(), kind: 'week', auto: true, state: 'asked' });
    } catch (e) { console.error('nightly: ' + e.message); }
  };
  nightly(); setInterval(nightly, 5 * 60e3);
  let busy = false;
  db.doc(ref).onSnapshot(async s => {
    const a = s.exists ? s.data() : null;
    if (!a || a.state !== 'asked' || busy) return;
    if (Date.now() - (a.at || 0) > 5 * 60e3) return write(uid, ref, Object.assign({}, a, { state: 'stale' }));
    busy = true;
    const t0 = Date.now(), stamp = () => new Date().toLocaleTimeString();
    console.log(stamp() + (a.kind === 'week' ? ' week plan' + (a.auto ? ' (nightly)' : '') : a.kind === 'tell' ? ' tell: ' + String(a.text || '').slice(0, 80) : a.kind === 'move' ? ' move: ' + a.title + ' ' + a.date : ' asked for ' + a.date + ' (' + (a.slots || '?') + ' slots)'));
    try {
      await write(uid, ref, Object.assign({}, a, { state: 'working', pickedAt: Date.now() }));
      let n;
      if (a.kind === 'week') n = await planWeek();
      else if (a.kind === 'tell') n = await tell(a.text, a.date);
      else if (a.kind === 'move') n = await moveSmart(a);
      else {
        const out = await buildPull(7);
        const p = await askClaude(fitPrompt(out, a));
        (p.ops || []).forEach(o => { if (o.op && !o.op.date) o.op.date = a.date; });
        n = await proposeObj(p, { kind: 'ideas' });
      }
      await write(uid, ref, Object.assign({}, a, { state: 'done', n, doneAt: Date.now() }));
      console.log(stamp() + ' sent ' + n + ' ideas in ' + Math.round((Date.now() - t0) / 1000) + 's');
    } catch (e) {
      console.error(stamp() + ' failed: ' + e.message);
      await write(uid, ref, Object.assign({}, a, { state: 'error', error: String(e.message).slice(0, 300) })).catch(() => {});
    }
    busy = false;
  }, e => console.error('watch: ' + e.message));
  await new Promise(() => {});
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
    else if (cmd === 'watch') await watch();
    else if (cmd === 'tell') { const dry = process.argv.includes('--dry'); const txt = process.argv.slice(3).filter(x => x !== '--dry').join(' '); const n = await tell(txt, null, dry); if (!dry) console.log('Sent ' + n + ' to the inbox.'); }
    else if (cmd === 'week') { const n = await planWeek(a1 === '--dry'); if (a1 !== '--dry') console.log('Sent ' + n + ' to the inbox.'); }
    else if (cmd === 'ideas') { const p = await askClaude(fitPrompt(await buildPull(7), { date: a1 || today(), slots: 3 })); console.log(JSON.stringify(p, null, 1)); }
    else if (cmd === 'uid') { if (!a1) die('usage: uid <id>'); writeConf(Object.assign(readConf(), { uid: a1 })); console.log('uid saved'); }
    else console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
  } catch (e) { die(e.message || String(e)); }
  process.exit(0);
})();

// node test.js : syntax + logic + invariant guards. No browser needed.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const read = f => fs.readFileSync(__dirname + '/' + f, 'utf8');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } };

// syntax
['core.js', 'app.js', 'sw.js'].forEach(f => t('syntax ' + f, () => new vm.Script(read(f), { filename: f })));
const html = read('index.html');
t('module script parses', () => { const m = html.match(/<script type="module">([\s\S]*?)<\/script>/); assert(m); new vm.Script(m[1].replace(/^\s*import .*$/gm, ''), { filename: 'module' }); });

// guards
t('never writes Tenfold users/ doc', () => { assert(!/setDoc\(\s*doc\(\s*db\s*,\s*'users'/.test(html)); assert(!/deleteDoc\(\s*doc\(\s*db\s*,\s*'users'/.test(html)); });
t('never writes Tenfold localStorage', () => { const a = read('app.js'); assert(!/setItem\(\s*['"]ptd_/.test(a)); assert(!/removeItem\(\s*['"]ptd_/.test(a)); });
t('saarthi guard exists', () => { const s = read('saarthi/saarthi.js'); assert(/assertPlannerPath/.test(s)); assert(!/collection\(\s*['"]users['"]\s*\)\.doc\([^)]*\)\.(set|update|delete)/.test(s)); });
t('light theme defines every core colour token', () => { const root = html.match(/:root\{([\s\S]*?)\n\}/)[1]; ['--bg', '--surface', '--ink', '--muted', '--line', '--accent', '--accent-soft', '--accent-ink', '--done', '--mark', '--skip', '--warn', '--alert'].forEach(k => assert(root.includes(k + ':'), k)); });
t('my-routine.json not tracked', () => assert(/my-routine\.json/.test(read('.gitignore'))));

// core logic
const ctx = {}; vm.createContext(ctx); vm.runInContext(read('core.js'), ctx);
const X = ctx.DBX;
const cfg = X.seedConfig();
const TODAY = '2026-10-01'; // Thursday
const store = { days: {} };
const noOverlap = d => { const L = d.blocks.filter(X.live).sort((a, b) => a.start - b.start); for (let i = 1; i < L.length; i++) if (L[i].start < L[i - 1].start + L[i - 1].dur) return L[i - 1].title + ' x ' + L[i].title; return null; };

t('week is Monday-Sunday', () => { assert.strictEqual(X.weekStart('2026-10-05'), '2026-10-05'); assert.strictEqual(X.weekStart('2026-10-04'), '2026-09-28'); });
t('merge: user values override seeds', () => {
  const m = X.mergeConfig({ settings: { bedtime: 1300 }, cats: [{ id: 'goal', name: 'Mine', color: '#000', group: 'free' }] });
  assert.strictEqual(m.settings.bedtime, 1300); assert.strictEqual(m.settings.dayStart, 360);
  assert.strictEqual(m.cats.find(c => c.id === 'goal').name, 'Mine'); assert(m.cats.find(c => c.id === 'waster'));
});
const sig = d => d.blocks.filter(X.live).map(b => b.title + '@' + b.start + '+' + b.dur).sort().join('|');
t('templates migrate into recurring blocks with the same day shape', () => {
  const raw = { weekPlans: {}, rules: [
      { id: 'r1', title: 'Pillar', cat: 'pillar', start: 540, dur: 35, days: [0, 1, 2, 3, 4, 5, 6], pillar: true },
      { id: 'r2', title: 'nvs', cat: 'office', start: 690, dur: 30, days: [1, 2, 4] } ],
    templates: [
      { id: 'a', name: 'Thu', days: [4], blocks: [{ id: 'x1', start: 660, dur: 120, title: 'Work', cat: 'office', checks: true, attach: [] }] },
      { id: 'b', name: 'Workday', days: [1, 2, 3, 4, 5], blocks: [{ id: 'x2', start: 660, dur: 120, title: 'Work', cat: 'office', checks: true, attach: [] }, { id: 'x3', start: 1350, dur: 60, title: 'Blackout', cat: 'sleep', attach: [] }, { id: 'x4', start: 500, dur: 60, title: 'Pillar', cat: 'goal', attach: [] }] },
      { id: 'c', name: 'Weekend', days: [0, 6], blocks: [{ id: 'x5', start: 600, dur: 120, title: 'Family', cat: 'family', attach: ['games'] }] } ] };
  const before = []; for (let i = 0; i < 7; i++) before.push(sig(X.buildDay(raw, X.addDays('2026-10-05', i))));
  assert(X.migrateTemplates(raw)); assert(raw.templates.every(t => t.deleted)); assert(!X.migrateTemplates(raw));
  for (let i = 0; i < 7; i++) assert.strictEqual(sig(X.buildDay(raw, X.addDays('2026-10-05', i))), before[i], 'day ' + i);
  assert.strictEqual(raw.rules.filter(r => r.title === 'Work').length, 3); // Mon/Tue/Thu split in 2, Wed/Fri whole
  assert(raw.rules.find(r => r.title === 'Family').attach[0] === 'games');
  assert(!raw.rules.some(r => r.title === 'Pillar' && r.cat === 'goal'));
});
t('seed config has no templates, only recurring blocks', () => { assert(cfg.templates.every(x => x.deleted)); assert(X.buildDay(cfg, TODAY).blocks.some(b => b.title === 'Deep work')); assert(!X.buildDay(cfg, TODAY).tpl); });
t('Friday: no kids slot, little adventure', () => { const d = X.buildDay(cfg, '2026-10-02'); assert(!d.blocks.some(b => b.title === 'Kids slot')); assert(d.blocks.some(b => b.title === 'Little adventure')); });
t('routine edit never changes a stored day', () => {
  const c = X.clone(cfg), s = { days: {} };
  const d = X.buildDay(c, TODAY); d.virtual = false; s.days[TODAY] = d;
  X.editRule(c, c.rules.find(r => r.title === 'Kids slot').id, { start: 960 }, TODAY);
  assert.strictEqual(X.getDay(s, c, TODAY, TODAY).blocks.find(b => b.title === 'Kids slot').start, 1020);
  assert.strictEqual(X.getDay(s, c, '2026-10-05', TODAY).blocks.find(b => b.title === 'Kids slot').start, 960);
});
t('past untouched day is untracked, not rebuilt', () => { const d = X.getDay(store, cfg, '2026-09-20', TODAY); assert(d.untracked); assert.strictEqual(d.blocks.length, 0); });
t('rule edit is effective-dated', () => {
  const c = X.clone(cfg);
  const nr = X.editRule(c, 'r_mp', { start: 600 }, TODAY);
  const old = c.rules.find(r => r.id === 'r_mp');
  assert.strictEqual(old.to, '2026-09-30'); assert.strictEqual(nr.from, TODAY);
  assert.strictEqual(X.activeRules(c, '2026-09-29').find(r => r.title === 'Morning pillar').start, 540);
  assert.strictEqual(X.activeRules(c, TODAY).find(r => r.title === 'Morning pillar').start, 600);
  assert.strictEqual(X.activeRules(c, TODAY).filter(r => r.title === 'Morning pillar').length, 1);
});
t('lock snapshots the plan once', () => { const d = X.buildDay(cfg, TODAY); d.virtual = false; assert(X.lockIfDue(d, TODAY)); assert(d.plan.length > 0); assert(!X.lockIfDue(d, TODAY)); const f = X.buildDay(cfg, '2026-10-09'); f.virtual = false; assert(!X.lockIfDue(f, TODAY)); });
t('lanes for overlaps', () => { const L = X.lanes([{ id: 'a', start: 0, dur: 60 }, { id: 'b', start: 30, dur: 60 }, { id: 'c', start: 120, dur: 30 }]); assert.strictEqual(L.a.lanes, 2); assert.strictEqual(L.b.lane, 1); assert.strictEqual(L.c.lanes, 1); });
t('gaps', () => { const g = X.gaps([{ start: 600, dur: 60, status: 'planned' }, { start: 700, dur: 20, status: 'skipped' }], 540, 800, 15); assert.strictEqual(JSON.stringify(g.map(x => [x.start, x.end])), "[[540,600],[660,800]]"); });
t('suggest picks behind regular items and diverse cats', () => {
  const s = X.suggest(cfg, store, null, TODAY, { start: 600, end: 690 }, TODAY, 3);
  assert(s.length === 3); assert.strictEqual(new Set(s.map(x => x.item.cat)).size, 3);
  assert(s.some(x => x.item.title === 'Study'));
});
t('suggest respects gap length', () => { const s = X.suggest(cfg, store, null, TODAY, { start: 600, end: 620 }, TODAY, 3); assert(s.every(x => x.min <= 20)); assert(!s.some(x => x.item.title === 'Visit a new place')); });
t('tenfold goals join candidates (read-only shape)', () => {
  const tf = { goals: [{ id: 'p', name: 'Get fit', cat: 'Health', sec: 'active' }, { id: 'g1', name: 'Run 5k', cat: 'Health', sec: 'active', parentId: 'p' }, { id: 'g2', name: 'Old', sec: 'someday' },
    { id: 'g3', name: 'Gone', sec: 'active', deleted: true, parentId: 'p' }, { id: 'g4', name: 'Swim', sec: 'active', parentId: 'p', done: true }, { id: 'g5', name: 'Later', sec: 'yearly', parentId: 'p' }] };
  const gs = X.tfGoals(cfg, tf); assert.strictEqual(gs.length, 1, 'only open minis'); assert.strictEqual(gs[0].cat, 'health');
  assert(X.candidates(cfg, tf).some(c => c.id === 'tf:g1'));
});
t('fillDay leaves the buffer free and does not touch store', () => {
  const r = X.fillDay(cfg, store, null, '2026-10-05', TODAY, 0);
  assert(r.added.length > 0);
  const s = cfg.settings, free0 = X.gaps(X.buildDay(cfg, '2026-10-05').blocks, s.dayStart, s.bedtime, 30).reduce((a, g) => a + g.end - g.start, 0);
  const used = r.added.reduce((a, b) => a + b.dur, 0); assert(used <= free0 * (1 - s.buffer) + 1);
  assert.strictEqual(Object.keys(store.days).length, 0);
});
t('backup flow', () => {
  const d = X.buildDay(cfg, TODAY); const mp = d.blocks.find(b => b.title === 'Morning pillar');
  const offers = X.backupOffers(d, 700); assert.strictEqual(offers.length, 1); assert.strictEqual(offers[0].at, 1080);
  assert(!X.backupOffers(d, 700).some(o => o.block.title === 'Evening pillar'));
  const nb = X.useBackup(d, mp.id, 1080); assert.strictEqual(mp.status, 'moved'); assert.strictEqual(nb.start, 1080); assert(!noOverlap(d), noOverlap(d));
  assert.strictEqual(X.backupOffers(d, 1200).filter(o => o.block.title === 'Morning pillar').length, 0);
  nb.status = 'done'; const st = X.dayStats(cfg, d); assert.strictEqual(st.pillarsKept, 1);
});
t('missed yesterday => do not miss twice', () => { const s = { days: {} }; const y = X.buildDay(cfg, '2026-09-30'); y.blocks.find(b => b.title === 'Evening pillar').status = 'skipped'; s.days['2026-09-30'] = y; assert(X.missedYesterday(s, cfg, TODAY).has('Evening pillar')); });
t('principle checks', () => {
  const d = X.buildDay(cfg, TODAY); d.blocks.push({ id: 'w', start: 840, dur: 60, title: 'Phone', cat: 'waster', status: 'planned' });
  const pc = X.principleChecks(cfg, d, new Set());
  assert(pc.list.some(a => /before 19:00/.test(a.t)));
});
t('reports + direction + streaks', () => {
  const s = { days: {} };
  for (let i = 0; i < 20; i++) { const k = X.addDays(TODAY, -i); const d = X.buildDay(cfg, k); d.virtual = false; d.blocks.forEach((b, j) => { b.status = j % 3 ? 'done' : 'skipped'; }); d.blocks.filter(b => b.pillar).forEach(b => { b.status = 'done'; }); s.days[k] = d; }
  const r = X.rangeReport(cfg, s, X.addDays(TODAY, -6), TODAY); assert.strictEqual(r.tracked, 7); assert(r.keptPct > 0 && r.keptPct < 1);
  assert.strictEqual(X.direction(cfg, s, TODAY).length, 4);
  assert.strictEqual(X.streaks(cfg, s, TODAY).find(x => x.title === 'Morning pillar').days, 20);
});
t('sanyam analysis finds the empty-gap pattern', () => {
  const s = { days: {} }, slips = [];
  for (let i = 1; i <= 14; i++) {
    const k = X.addDays(TODAY, -i); const d = X.buildDay(cfg, k); d.virtual = false;
    if (i % 3 === 0) { d.blocks = d.blocks.filter(b => b.start < 700 || b.start > 1000); slips.push({ id: 's' + i, h: 'h1', d: k }); }
    s.days[k] = d;
  }
  const tf = { sanyam: slips, sanyamcfg: { h1: { name: 'No phone', kind: 'slip' } } };
  const a = X.sanyamAnalysis(cfg, s, tf, TODAY)[0];
  assert.strictEqual(a.slips, 4); assert(a.enough); assert(a.findings.some(f => /empty/.test(f)), a.findings.join(' | '));
});
t('mergeCloud: newer wins per doc', () => {
  const l = { config: { updated: 5 }, days: { a: { updated: 10 }, b: { updated: 1 }, c: { updated: 3 } } };
  const m = X.mergeCloud(l, { config: { updated: 9 }, days: { a: { updated: 5 }, b: { updated: 7 } } });
  assert.strictEqual(m.config.updated, 9); assert.strictEqual(m.days.b.updated, 7); assert.strictEqual(m.days.a.updated, 10);
  assert.strictEqual(m.pushDays.sort().join(), 'a,c');
});
t('applyOp: day + template + errors', () => {
  const c = X.clone(cfg), s = { days: {} };
  const r1 = X.applyOp(c, s, { type: 'addBlock', date: '2026-10-05', block: { start: 1290, dur: 30, title: 'Guitar', cat: 'hobby' } }, TODAY);
  assert(r1.day.blocks.some(b => b.title === 'Guitar')); assert.strictEqual(Object.keys(s.days).length, 0);
  assert(/unknown op/.test(X.applyOp(c, s, { type: 'editTemplateBlock', tpl: 'Workday', title: 'Deep work', start: 600 }, TODAY).error));
  assert(X.applyOp(c, s, { type: 'moveBlock', date: TODAY, title: 'Nope', start: 1 }, TODAY).error);
});
t('applyOp: addRule + editRule are effective-dated', () => {
  const c = X.clone(cfg), s = { days: {} };
  assert(X.applyOp(c, s, { type: 'addRule', rule: { title: '32co standup', cat: 'office', start: 630, dur: 30, days: [1, 2, 3, 4, 5] } }, TODAY).cfg);
  assert(X.applyOp(c, s, { type: 'addRule', rule: { title: 'x' } }, TODAY).error);
  assert(X.applyOp(c, s, { type: 'editRule', title: 'Morning pillar', patch: { title: 'Morning prayer (Sundarkand)' } }, TODAY).cfg);
  assert(X.buildDay(c, '2026-10-05').blocks.some(b => b.title === 'Morning prayer (Sundarkand)' && b.pillar && b.backup === 1080));
  assert(X.buildDay(c, '2026-10-05').blocks.some(b => b.title === '32co standup'));
  assert(!noOverlap(X.buildDay(c, '2026-10-05')), noOverlap(X.buildDay(c, '2026-10-05')));
  assert.strictEqual(X.buildDay(c, '2026-09-29').blocks.find(b => b.title === 'Deep work').dur, 85); // old version before today
  assert.strictEqual(X.buildDay(c, '2026-10-05').blocks.find(b => b.title === 'Deep work').dur, 55);  // trimmed to 09:35-10:30
  assert(!X.activeRules(c, '2026-09-30').some(r => r.title === '32co standup'));
  assert(X.activeRules(c, '2026-09-30').some(r => r.title === 'Morning pillar'));
  assert(X.applyOp(c, s, { type: 'editRule', title: 'Nope', patch: {} }, TODAY).error);
});
t('mergeCloud: live partial snapshot never pushes untouched data', () => {
  const l = { config: { updated: 5 }, days: { a: { updated: 10 }, b: { updated: 1 } } };
  const m = X.mergeCloud(l, { days: { b: { updated: 7 } }, partial: true });
  assert(!m.pushConfig); assert.strictEqual(m.pushDays.length, 0); assert.strictEqual(m.days.b.updated, 7);
});
t('placeBlock + addTodo', () => {
  const c = X.clone(cfg), s = { days: {} };
  const d = X.buildDay(c, '2026-10-05');
  const b = X.placeBlock(c, d, { title: 'Report', min: 60, cat: 'office' }, 600);
  assert(b && b.start >= 600 && b.dur === 60);
  assert(X.gaps(d.blocks.filter(x => x !== b), 0, 1440, 1).some(g => g.start <= b.start && g.end >= b.start + 60));
  assert.strictEqual(X.placeBlock(c, d, { title: 'Huge', min: 900 }, 600), null);
  const r = X.applyOp(c, s, { type: 'addTodo', date: '2026-10-05', todo: { title: 'Call bank', min: 15 } }, TODAY);
  assert.strictEqual(r.day.todo[0].title, 'Call bank');
});
t('routine never produces overlaps (seeds)', () => { for (let i = 0; i < 7; i++) { const k = X.addDays('2026-10-05', i); const o = noOverlap(X.buildDay(cfg, k)); assert(!o, k + ': ' + o); } });
t('carve splits around a recurring block', () => {
  const p = X.carve([{ id: 'w', start: 660, dur: 120, title: 'Work', attach: [{ t: 'x' }] }], [{ start: 690, dur: 30 }]);
  assert.strictEqual(JSON.stringify(p.map(x => [x.start, x.dur])), '[[660,30],[720,60]]'); assert.strictEqual(p[0].id, 'w'); assert.strictEqual(p[1].attach.length, 0);
  assert.strictEqual(X.carve([{ id: 'a', start: 600, dur: 20 }], [{ start: 605, dur: 10 }]).length, 0);
});
t('ops refuse overlaps', () => {
  const c = X.clone(cfg), s = { days: {} };
  assert(X.applyOp(c, s, { type: 'addBlock', date: '2026-10-05', block: { start: 540, dur: 30, title: 'X', cat: 'goal' } }, TODAY).error);
  assert(X.applyOp(c, s, { type: 'addRule', rule: { title: 'Clash', cat: 'office', start: 550, dur: 30, days: [1] } }, TODAY).error);
  assert(X.applyOp(c, s, { type: 'moveBlock', date: '2026-10-05', title: 'Kids slot', start: 1140 }, TODAY).error);
  const d = X.buildDay(c, TODAY); const mp = d.blocks.find(b => b.title === 'Morning pillar');
  d.blocks = d.blocks.filter(b => b.title !== 'Clock off'); d.blocks.push({ id: 'z', start: 1080, dur: 60, title: 'Busy', cat: 'goal', status: 'done' });
  const off = X.backupOffers(d, 700).find(o => o.block === mp); assert.strictEqual(off.at, 1230);
  X.useBackup(d, mp.id, off.at); assert(!noOverlap(d), noOverlap(d));
});
t('old seed colours move to the new palette, custom ones stay', () => {
  const m = X.mergeConfig({ cats: [{ id: 'goal', name: 'Goal', color: '#6C4FD0', group: 'free' }, { id: 'office', name: 'Office', color: '#123456', group: 'fixed' }] });
  assert.strictEqual(m.cats.find(c => c.id === 'goal').color, '#7B5CFA'); assert.strictEqual(m.cats.find(c => c.id === 'office').color, '#123456');
});
t('categories: add, soft delete moves rules + items, free time = has a balance share', () => {
  const m = X.seedConfig();
  const c = X.addCat(m, ' Music '); assert.strictEqual(c.name, 'Music'); assert(!X.freeCats(m).includes(c.id));
  m.settings.balance[c.id] = 10; assert(X.freeCats(m).includes(c.id)); assert(!X.freeCats(m).includes('office'));
  m.settings.balance.hobby = 20;
  const moved = X.deleteCat(m, 'hobby', c.id);
  assert(moved && moved.items >= 1); assert(!m.items.some(i => i.cat === 'hobby')); assert(!('hobby' in m.settings.balance));
  assert(!X.liveCats(m).some(x => x.id === 'hobby')); assert.strictEqual(X.catOf(m, 'hobby').name, 'Hobby'); // past days still resolve
  assert.strictEqual(X.deleteCat(m, 'leisure', 'hobby'), false); // cannot move into a deleted one
  const again = X.mergeConfig(JSON.parse(JSON.stringify(m))); assert(again.cats.find(x => x.id === 'hobby').deleted); // seed does not come back
});
t('nuggets sit in the category named like their Tenfold category; missing ones get added once', () => {
  const m = X.seedConfig();
  const tf = { goals: [{ id: 'p', name: 'Fit', cat: 'Health', sec: 'yearly' }, { id: 'a', name: 'Run', sec: 'active', parentId: 'p' }, { id: 'q', name: 'Learn', cat: 'Learning', sec: 'yearly' }, { id: 'b', name: 'Spanish', cat: 'Learning', sec: 'active', parentId: 'q' }] };
  assert.strictEqual(X.tfGoals(m, tf).find(g => g.id === 'a').cat, 'health'); assert.strictEqual(X.tfGoals(m, tf).find(g => g.id === 'a').name, 'Fit'); assert.strictEqual(X.tfGoals(m, tf).find(g => g.id === 'a').mini, 'Run'); // shown by the parent name // inherits parent's Tenfold category
  assert.strictEqual(X.ensureTfCats(m, tf).join(), 'Learning'); assert.strictEqual(X.ensureTfCats(m, tf).length, 0);
  const lc = m.cats.find(c => c.name === 'Learning'); assert.strictEqual(X.tfGoals(m, tf).find(g => g.id === 'b').cat, lc.id);
  X.deleteCat(m, lc.id); assert.strictEqual(X.ensureTfCats(m, tf).length, 0); // deleted stays deleted
});
t('hobbies/leisure: no length of their own, sized to the gap, least done lately first; dreams never done', () => {
  const m = X.seedConfig(); m.items = [{ id: 'f1', kind: 'fun', title: 'Guitar', cat: 'hobby' }, { id: 'f2', kind: 'fun', title: 'Chess', cat: 'hobby' }, { id: 'd1', kind: 'dream', title: 'Trek', cat: 'leisure', min: 60, done: true }];
  const st = { days: { [X.addDays(TODAY, -1)]: { date: X.addDays(TODAY, -1), blocks: [{ id: 'x', start: 600, dur: 60, title: 'Guitar', cat: 'hobby', status: 'done' }] } } };
  const s = X.suggest(m, st, null, TODAY, { start: 600, end: 720 }, TODAY, 3);
  const g = s.find(x => x.item.id === 'f1'), c = s.find(x => x.item.id === 'f2');
  assert(c.score > g.score, 'chess (never done) beats guitar (yesterday)'); assert(c.min >= 20 && c.min <= 60);
  assert(X.candidates(m, null).some(i => i.id === 'd1'));
  assert.strictEqual(X.hoursDone(st, m.items[0]), 60);
});
t('nuggets: chunk from you, minutes left from Tenfold, gone when nothing is left', () => {
  const m = X.seedConfig(); m.items = []; m.tf.goalMap = { a: { chunk: 30 } };
  const tf = { goals: [{ id: 'p', name: 'Fit', cat: 'Health', unit: 'hours', sec: 'yearly' }, { id: 'a', name: 'Run', sec: 'active', parentId: 'p', cur: 1.8, target: 2 },
    { id: 'b', name: 'Swim', sec: 'active', parentId: 'p', cur: 5, target: 5 }, { id: 'c', name: 'Pages', sec: 'active', parentId: 'p', unit: 'pages', minPerUnit: 0, cur: 1, target: 9 }] };
  const gs = X.tfGoals(m, tf), a = gs.find(g => g.id === 'a');
  assert.strictEqual(a.leftMin, 12); assert.strictEqual(a.chunk, 30); assert.strictEqual(gs.find(g => g.id === 'c').leftMin, null);
  const ids = X.candidates(m, tf).map(i => i.id); assert(ids.includes('tf:a') && ids.includes('tf:c') && !ids.includes('tf:b'));
  const s = X.suggest(m, { days: {} }, tf, TODAY, { start: 600, end: 720 }, TODAY, 5).find(x => x.item.id === 'tf:a');
  assert.strictEqual(s.min, 15); // only 12 min left, so a short chunk
});
t('types: seeded, old groups migrate, add/delete moves categories, office + sleep stay', () => {
  const m = X.mergeConfig({ cats: [{ id: 'office', name: 'Office', color: '#2F7BF5', group: 'fixed' }, { id: 'c_x', name: 'Mine', color: '#111111', group: 'sleep' }, { id: 'c_y', name: 'Other', color: '#222222' }] });
  assert.strictEqual(X.liveTypes(m).map(t => t.id).join(), 'office,goal,nongoal,sleep');
  assert.strictEqual(X.catOf(m, 'office').type, 'office'); assert.strictEqual(X.catOf(m, 'c_x').type, 'sleep'); assert.strictEqual(X.catOf(m, 'c_y').type, 'nongoal');
  assert(X.isSleep(m, 'c_x')); assert(X.isSleep(m, 'sleep'));
  const t = X.addType(m, 'Family'); m.cats.find(c => c.id === 'family').type = t.id;
  assert.strictEqual(X.deleteType(m, 'office', 'goal'), false); assert.strictEqual(X.deleteType(m, t.id, t.id), false);
  assert.strictEqual(X.deleteType(m, t.id, 'nongoal'), 1); assert.strictEqual(X.catOf(m, 'family').type, 'nongoal');
  const again = X.mergeConfig(JSON.parse(JSON.stringify(m))); assert(again.types.find(x => x.id === t.id).deleted);
  m.types.find(x => x.id === 'goal').deleted = true; const g = X.mergeConfig(JSON.parse(JSON.stringify(m)));
  assert.strictEqual(X.catOf(g, 'goal').type, 'nongoal'); // category of a deleted type falls back
});
t('report: hours per type', () => {
  const m = X.seedConfig(); const k = X.addDays(TODAY, -1);
  const st = { days: { [k]: { date: k, blocks: [{ id: 'a', start: 600, dur: 60, title: 'Work', cat: 'office', status: 'done' }, { id: 'b', start: 700, dur: 30, title: 'Admin', cat: 'admin', status: 'done' }, { id: 'c', start: 800, dur: 60, title: 'Guitar', cat: 'hobby', status: 'skipped' }] } } };
  const r = X.rangeReport(m, st, k, k);
  assert.strictEqual(r.byType.office.actual, 90); assert.strictEqual(r.byType.nongoal.planned, 60); assert.strictEqual(r.byType.nongoal.actual, 0);
});
t('ops: setStatus, removeTodo, at picks one of two same-title blocks', () => {
  const m = X.seedConfig(); const k = TODAY;
  const st = { days: { [k]: { date: k, blocks: [{ id: 'a', start: 600, dur: 30, title: 'Walk', cat: 'health', status: 'planned' }, { id: 'b', start: 900, dur: 30, title: 'Walk', cat: 'health', status: 'planned' }], todo: [{ id: 't', title: 'Exercise', min: 30 }] } } };
  let r = X.applyOp(m, st, { type: 'removeBlock', date: k, title: 'Walk', at: 900 }, k); assert(!r.error, r.error);
  assert.strictEqual(r.day.blocks.length, 1); assert.strictEqual(r.day.blocks[0].start, 600); st.days[k] = r.day;
  r = X.applyOp(m, st, { type: 'setStatus', date: k, title: 'walk', status: 'done' }, k); assert.strictEqual(r.day.blocks[0].status, 'done'); st.days[k] = r.day;
  assert(X.applyOp(m, st, { type: 'setStatus', date: X.addDays(k, 1), title: 'Walk', status: 'done' }, k).error, 'future cannot be done');
  r = X.applyOp(m, st, { type: 'removeTodo', date: k, title: 'exercise' }, k); assert.strictEqual(r.day.todo.length, 0);
  assert(X.applyOp(m, st, { type: 'removeTodo', date: k, title: 'Nope' }, k).error);
});
t('deleteRule: all versions gone, planned blocks from today removed, past days kept', () => {
  const m = X.seedConfig(); const r = m.rules.find(x => x.id === 'r_kids');
  const nr = X.editRule(m, r.id, { start: 1030 }, TODAY);
  const past = X.addDays(TODAY, -1), fut = X.addDays(TODAY, 1);
  const st = { days: { [past]: { date: past, blocks: [{ id: 'p', start: 1020, dur: 45, title: 'Kids slot', ruleId: r.id, status: 'done' }] }, [fut]: { date: fut, blocks: [{ id: 'f', start: 1030, dur: 45, title: 'Kids slot', ruleId: nr.id, status: 'planned' }] } } };
  const ch = X.deleteRule(m, st, nr.id, TODAY);
  assert(m.rules.find(x => x.id === r.id).deleted && m.rules.find(x => x.id === nr.id).deleted, 'both versions');
  assert.strictEqual(ch.join(), fut); assert.strictEqual(st.days[fut].blocks.length, 0); assert.strictEqual(st.days[past].blocks.length, 1);
});
t('ops: editItem renames a bank item, removeItem deletes it', () => {
  const m = X.seedConfig(); m.items = [{ id: 'f', kind: 'fun', title: 'painting', cat: 'hobby' }];
  assert(!X.applyOp(m, { days: {} }, { type: 'editItem', title: 'Painting', patch: { title: 'Painting & mandala' } }, TODAY).error);
  assert.strictEqual(m.items[0].title, 'Painting & mandala');
  assert(X.applyOp(m, { days: {} }, { type: 'editItem', title: 'nope', patch: {} }, TODAY).error);
  X.applyOp(m, { days: {} }, { type: 'removeItem', title: 'painting & mandala' }, TODAY); assert(m.items[0].deleted);
});
t('picks lottery: fixed per week, no repeats across lines, cooldown, keeps lines already set', () => {
  const m = X.seedConfig(); m.weekPlans = {};
  m.items = ['Trek', 'Picnic', 'Fort', 'Lake'].map((t, i) => ({ id: 'l' + i, kind: 'fun', title: t, cat: 'leisure', min: i < 2 ? 240 : 45 })).concat({ id: 's0', kind: 'fun', title: 'Journal', cat: 'self' });
  const ws = X.addDays(X.weekStart(TODAY), 7), st = { days: {} };
  const a = X.clone(m), b = X.clone(m);
  X.autoPicks(a, st, null, ws, TODAY); X.autoPicks(b, st, null, ws, TODAY);
  assert.strictEqual(JSON.stringify(a.weekPlans[ws]), JSON.stringify(b.weekPlans[ws]), 'same week, same draw');
  const wp = a.weekPlans[ws];
  assert(wp.big && wp.little && wp.self); assert.notStrictEqual(wp.big.itemId, wp.little.itemId); assert.strictEqual(wp.self.text, 'Journal');
  assert.strictEqual(wp.big.dur, 240); assert(['l0', 'l1'].includes(wp.big.itemId) && ['l2', 'l3'].includes(wp.little.itemId), 'big = long ones, little = short'); assert(wp.big.auto && wp.big.start == null);
  // hand-set line stays
  a.weekPlans[ws].little = { text: 'Lake', itemId: 'l3', cat: 'leisure', date: null, start: null, dur: 45 };
  assert(!X.autoPicks(a, st, null, ws, TODAY)); assert.strictEqual(a.weekPlans[ws].little.text, 'Lake');
  // cooldown: what was picked last week is not drawn this week
  const ws2 = X.addDays(ws, 7); X.autoPicks(a, st, null, ws2, TODAY);
  const last = new Set(Object.values(a.weekPlans[ws]).map(v => v.itemId));
  ['big', 'little'].forEach(k => { const v = a.weekPlans[ws2][k]; if (v) assert(!last.has(v.itemId), k + ' repeats ' + v.text); });
});
t('deleteRule on a past version leaves the live block and the days alone', () => {
  const m = X.seedConfig(); const r = m.rules.find(x => x.id === 'r_kids');
  const nr = X.editRule(m, r.id, { start: 1030 }, X.addDays(TODAY, -1));
  const st = { days: { [TODAY]: { date: TODAY, blocks: [{ id: 'k', start: 1030, dur: 45, title: 'Kids slot', ruleId: r.id, status: 'planned' }] } } };
  assert.strictEqual(X.deleteRule(m, st, r.id, TODAY).length, 0);
  assert(m.rules.find(x => x.id === r.id).deleted); assert(!m.rules.find(x => x.id === nr.id).deleted, 'live one stays');
  assert.strictEqual(st.days[TODAY].blocks.length, 1);
});
t('routine ideas rotate one a day, every idea gets its turn', () => {
  const m = X.seedConfig(); const r = m.rules.find(x => x.id === 'r_kids'); r.attach = ['20 min study']; r.rotate = ['A', 'B', 'C', 'D', 'E'];
  const seen = []; let k = X.weekStart(TODAY);
  for (let i = 0; i < 21; i++, k = X.addDays(k, 1)) { const b = X.buildDay(m, k).blocks.find(x => x.ruleId === 'r_kids'); if (b) { seen.push(b.idea); assert.strictEqual(b.attach[0].t, '20 min study'); assert.strictEqual(b.attach[1].t, b.idea); } }
  ['A', 'B', 'C', 'D', 'E'].forEach(x => assert(seen.includes(x), x + ' never came'));
  for (let i = 1; i < seen.length; i++) assert.notStrictEqual(seen[i], seen[i - 1], 'same idea two days running');
});
t('setNugget: chunk kept when via is set, a via nugget is never booked or picked', () => {
  const m = X.seedConfig(); m.items = [];
  const tf = { goals: [{ id: 'p', name: 'Kids', cat: 'Learning', unit: 'Minutes', sec: 'yearly' }, { id: 'a', name: 'SRM', sec: 'active', parentId: 'p', cur: 0, target: 60 }] };
  X.applyOp(m, { days: {} }, { type: 'setChunk', goal: 'a', chunk: 20 }, TODAY);
  X.applyOp(m, { days: {} }, { type: 'setNugget', goal: 'a', via: 'Kids slot' }, TODAY);
  assert.strictEqual(m.tf.goalMap.a.chunk, 20); assert.strictEqual(X.tfGoals(m, tf)[0].via, 'Kids slot');
  assert(!X.candidates(m, tf).some(c => c.id === 'tf:a')); assert.strictEqual(X.pickPool(m, tf, 'career').length, 0);
  assert(X.applyOp(m, { days: {} }, { type: 'setChunk', goal: 'a', chunk: 5 }, TODAY).error);
});
t('possible: days, time of day and own hours are hard limits; nextSlot respects them', () => {
  const it = { days: [0, 6], zone: 'morning', from: 420, to: 720 };
  const sat = X.addDays(X.weekStart(TODAY), 5), mon = X.weekStart(TODAY);
  assert(X.possibleAt(it, sat, 480, 60)); assert(!X.possibleAt(it, mon, 480, 60), 'weekday'); assert(!X.possibleAt(it, sat, 400, 30), 'before its hours'); assert(!X.possibleAt(it, sat, 700, 60), 'after');
  const m = X.seedConfig(); m.rules = []; m.items = [];
  const b = { id: 'x', start: 1200, dur: 60, title: 'Gardening', cat: 'hobby', status: 'planned' };
  const st = { days: { [mon]: { date: mon, blocks: [b] } } };
  const n = X.nextSlot(m, st, b, mon, mon, 0, it);
  assert.strictEqual(n.date, sat); assert(n.start >= 420 && n.start + 60 <= 720);
});
t('ideas: random order, each one once per round, never twice in a row', () => {
  const r = { title: 'Kids', days: [0, 1, 2, 3, 4, 5, 6], rotate: ['A', 'B', 'C', 'D', 'E'] };
  let k = X.weekStart(TODAY); const seq = [];
  for (let i = 0; i < 30; i++, k = X.addDays(k, 1)) seq.push(X.ruleIdea(r, k));
  for (let i = 1; i < seq.length; i++) assert.notStrictEqual(seq[i], seq[i - 1]);
  assert.notStrictEqual(seq.slice(0, 5).join(), 'A,B,C,D,E', 'not plain order'); // (a 1-in-120 chance it is)
});
t('my-routine.json loads', () => {
  if (!fs.existsSync(__dirname + '/my-routine.json')) return;
  const o = JSON.parse(read('my-routine.json')); const m = X.mergeConfig(o.config);
  assert(m.rules.length && m.templates.every(x => x.deleted));
  for (let i = 0; i < 7; i++) { const k = X.addDays('2026-10-05', i); const d = X.buildDay(m, k); assert(d.blocks.length > 3, k); const o = noOverlap(d); assert(!o, 'my-routine ' + k + ': ' + o); }
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

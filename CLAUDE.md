# DayBox

Personal day planner / timeboxer with Saarthi (Claude Code as the coach). No build step: `index.html` + `core.js` (pure logic, also loaded by node) + `app.js` (UI). Runs on GitHub Pages (`26-saurabhmaheshwari.github.io/daybox/`) and from `file://` (local only, no sign-in).

## Hard rules
- **Never write Tenfold data.** Tenfold lives in the same Firebase project at `users/{uid}` and in localStorage keys `ptd_*`. DayBox only READS them (goals, sanyam). test.js guards this. Saarthi's `assertPlannerPath` blocks any write outside `planner/{uid}/`.
- **Never touch Firestore Rules** (user pastes). Current block: `match /planner/{uid}/{rest=**} { allow read, write: if request.auth != null && request.auth.uid == uid; }`.
- **Repo is public**: seeds in `core.js` stay neutral. The user's real routine lives in `my-routine.json` (gitignored, imported once via Settings).
- Service account key: `~/.daybox/saarthi-key.json` (role Cloud Datastore User). Never in the repo, never printed.
- Run `node test.js` (PowerShell; node is blocked in the Bash hook) after any JS edit. Commit + push finished changes (auto-push, same as Tenfold).

## Data model (Firestore `planner/{uid}/...`, localStorage `dbx_*`)
- `meta/config`: settings, cats, rules (the whole routine: recurring blocks), items (bank), boredom, tf.goalMap, weekPlans. One doc, newer `updated` wins. Templates were removed 2026-10-02: `migrateTemplates` (in mergeConfig) turns any live template into rules once.
- **No overlaps**: active blocks never overlap (`clashWith`). Drag/editor/ops refuse; new recurring blocks trim plain ones (`makeRoom`), never pillars; pillar backups trim plain planned blocks.
- `days/{YYYY-MM-DD}`: `{blocks[], plan[] (snapshot when the day arrives), locked, tpl{id,version}, close{line,mit,at}, slipNote, updated}`. Per-doc newer wins.
- `meta/inbox`: Saarthi proposals `{ops:[{id,label,why,op,state}]}`. `meta/saarthi`: learnings. `history/*`: before-snapshots for undo.
- **Frozen days**: a stored day never changes when the routine changes. Untouched future days are computed live (`buildDay`); untouched past days are "not tracked". Rule edits are effective-dated (`editRule` ends the old row yesterday, new row from today).
- Auto-created today gets `updated: 1` so a real edit from another device wins the merge.
- Block: `{id,start,dur (min),title,cat,status planned|done|partial|skipped|moved,src tpl|rule|manual|bank|backup|week|saarthi,pillar,backup,strict,mit,checks,attach[{t,done}],unplanned,itemId,note}`.

## Saarthi
- `saarthi/saarthi.js` (firebase-admin): `pull`, `propose <file>`, `apply 1,3|all`, `reject`, `learn`, `undo`, `status`. Op types: see `applyOp` in core.js.
- Slash command `/saarthi` lives in `~/.claude/commands/saarthi.md`.

## Deploy
Account `26-saurabhmaheshwari`, branch `main`, GitHub Pages from root. Push:
```
gh auth switch --user 26-saurabhmaheshwari
git -C D:/daybox -c credential.helper= -c credential.helper='!f() { echo username=26-saurabhmaheshwari; echo "password=$(gh auth token)"; }; f' push origin main
gh auth switch --user surendrapatel-32co
```
- Bump the `?v=N` on the core.js / app.js script tags in index.html on every deploy (GitHub Pages caches JS ~10 min).

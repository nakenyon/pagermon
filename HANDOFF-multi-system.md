# Handoff — multi-system support for PagerMon

Working branch: **`feature/multi-system`** (11 commits ahead of `main`, not pushed).
Status: **Phases 0–5 complete, tested, browser-verified.** Phase 6 partly done.

This document is written for an agent or developer picking the work up cold. It
records what was built, what was found along the way, what is deliberately left
alone, and what to do next.

---

## 1. The problem, in one paragraph

A CAPCODE address is only unique *within* a paging system. PagerMon matched
`capcodes.address` globally, so one instance could not serve two networks: the
same address resolved to one arbitrary alias regardless of which network the
page came from. Verified against three live databases - 15 addresses collide
between York and Dauphin with genuinely different agencies (e.g. `0001000` is
`1-FIRE / West York` in one and `1-EMS / Life Team EMS` in the other). Aliases
and messages are now scoped to a first-class `system`.

The operator (Nathan) runs three instances - **york**, **dauphin**,
**cumberland** - and wants one container serving all three networks.

## 2. Source plan

`~/.claude/plans/this-is-going-to-async-robin.md` — the original phase plan,
amended before work started. Phase 6 in that document is **superseded** by
`~/.claude/plans/multi-system-phase-6-consolidation.md`.

---

## 3. Commits on the branch

| commit | what |
|---|---|
| `50b3f4e6` | **Phase 1** schema: `systems` table, `system_id` on `capcodes`/`messages`, `unique(system_id,address)`, backfill, FTS trigger narrowed |
| `db25008b` | **Phase 2** ingest: API-key principal, `lib/systems.js`, `lib/aliasrefresh.js`, scoped lookup/dedupe/capcodeCheck |
| `0357306d` | **Phase 3** read path: system filter on both list endpoints, `/api/systems` CRUD |
| `10cd0332` | **Phase 0** extract message-view Angular app to `themes/_shared/public/javascripts/messages.main.js` |
| `fc0898a9` | **Phase 4** selector, badge, live-update filtering |
| `dde85ae1` | **Phase 5** admin UI: Systems pages, alias System select, per-key System in Settings |
| `745f3eff` | changelog |
| `8e44f953` | `resolveForAdmin` vs `resolveForPost` split (bug found in live testing) |
| `22ba799a` | **Phase 6A-i** alias import chooses target system; export carries portable name |
| `ddbe5013` | remove unreachable anonymous alias column |

Test count: **326 passing, 0 failing** (`main` baseline was 289).

---

## 4. Key design decisions, and why

Read these before changing anything; several look arbitrary and are not.

**`system_id` is denormalised onto `messages`**, not derived through `alias_id`.
471 York messages have `alias_id IS NULL`; deriving would make all unmatched
traffic unattributable, and unmatched traffic is exactly what an operator looks
at when onboarding a system.

**API key principal is an object with `role: 'apikey'`** (`auth/local.js`). It
used to be a bare string, so `req.user.role` read `undefined` off a `String` at
six call sites and evaluated false. `'apikey'` is *deliberately not* `'admin'` -
`isAdmin`/`isLoggedIn` do not inspect `role` on the API-key branch, so an
unrecognised value preserves the old behaviour exactly. Setting `'admin'` would
flip all six and change what an API-key `GET /api/messages` returns under
`pdwMode` + `adminShow`.

**Two resolvers in `lib/systems.js`, and they must stay separate:**
- `resolveForPost` (ingest) - the API key is authoritative, the request body is
  ignored, except via `allowSourceOverride`. A reader must not be able to write
  into a system it was not granted.
- `resolveForAdmin` (capcode CRUD, import, capcodeCheck) - an explicit system in
  the request always wins. These routes are behind `isAdmin`, and `isAdmin`
  accepts an API key, so scripted capcode management would otherwise have every
  alias forced into the key's own ingest system.

**A key with no `system` configured resolves to the default system.** This is the
upgrade guarantee, not a convenience: it is the state every install is in
immediately after migrating and before anyone edits `config.json`. It must never
fail ingest or store a null `system_id`.

**The system selector is a view preference, not a permission.** Cookie
(`systemFilter`), no schema, works for anonymous viewers. All viewers may see
all systems.

**Referential integrity is enforced in application code.** knex 0.16 ignores
`.references()` in sqlite `alterTable`, and sqlite does not enforce FKs without
the pragma. The delete guard on `DELETE /api/systems/:id` (blocks while capcodes
or messages reference it; default system never deletable) is the *only* check.

**Alias import: the operator's choice overrides the file's `system` column.** A
CSV exported from another multi-system instance names *that* instance's systems,
which may not exist locally. `?system=file` opts into the column for
round-tripping.

---

## 5. Bugs found and fixed along the way

All have regression tests that fail against the pre-fix code.

1. **Unscoped alias refresh** (`lib/aliasrefresh.js`) - editing one system's
   alias re-pointed another system's messages. Fixed with a correlated
   `capcodes.system_id = messages.system_id` predicate. This was the single most
   damaging thing to get wrong: silent corruption, not an error.
2. **Ungrouped `OR` in the message list** - `ignore = 0 OR ignore IS NULL AND
   system_id IN (...)`; `AND` binds tighter, so the system filter applied only to
   messages with *no alias*, while the count query (grouped) reported the correct
   filtered total. **Found by smoke-testing against a copy of a real database -
   a fixture of unmatched messages passes either way.** The regression test uses
   matched messages.
3. **Ungrouped `OR` in message search** - `address LIKE ? OR source = ? AND
   alias_id IN (...)`; combining address with agency returned everything matching
   the address. Pre-existing bug, fixed in passing.
4. **`initData` was a module-level object** mutated per request by both list
   handlers; concurrent requests corrupted each other's pagination. Now
   per-request.
5. **Socket handler ignored the `alias` route param** - an alias-filtered view
   received every message on the system.
6. **`resolveForAdmin`/`resolveForPost` conflation** - see above; surfaced as a
   `UNIQUE constraint` error creating a cross-system alias with an API key.

### Lesson worth carrying forward

Two of these were invisible to the unit tests and only appeared when running
against a copy of real data. **Fixture data was too uniform** (all messages had
`alias_id IS NULL`). When adding tests here, make fixtures include *matched*
aliases, ignored capcodes and wildcards.

---

## 6. Known issues deliberately NOT fixed

These are pre-existing, confirmed present on `main`, and were tabled by the
operator. Do not fold them into this branch.

| issue | detail |
|---|---|
| **`faKey` error page** | `res.locals.faKey` is only set in `routes/index.js`, so `global/error.ejs` → `header.ejs` throws `faKey is not defined` on **every** error outside `/`. Express then falls back to its default `<pre>Bad Request</pre>`. Pre-existing since `1aa4a8b7` (2023). Breaks every error page app-wide. Own branch. |
| **`pluginconf` secrets in CSV export** | Alias exports contain live webhook URLs in cleartext. Operator is aware and accepts it - admin-only, and the values must survive export/import to keep webhooks working. |
| **Config leakage in tests** | `test/routes.admin.test.js` POSTs a full settings payload to the real `config/config.json`, including `database.file: ./messages.db`. Running the suite rewrites the dev config. Cost an hour of confusion; be aware. |

---

## 7. Files that matter

```
server/knex/migrations/20260901120000_multi_system.js   schema + backfill + FTS trigger narrowing
server/lib/systems.js                                   THE resolver - read the header comment
server/lib/aliasrefresh.js                              shared with the mysql cron in app.js
server/routes/api.js                                    ingest, read path, /api/systems, capcode CRUD/import/export
server/routes/index.js                                  res.locals.systems (drives server-side column gating)
server/auth/local.js                                    API-key principal
server/themes/_shared/public/javascripts/messages.main.js       message list app (was inline x4)
server/themes/_shared/public/javascripts/admin/admin.main.js    admin app (SystemController etc.)
server/themes/_shared/public/templates/admin/system*.html       new admin templates (shared, not per-theme)
server/test/routes.api.multisystem.test.js              36 acceptance tests
server/knex/seeds/test_data.js                          seeds 2 systems with explicit ids
```

### Gotchas in the test suite

- **Root-level hooks in every test file run for every test in the whole suite**,
  in file-load order. A file loaded later re-runs `migrate.rollback()` and
  re-seeds, destroying anything a root hook in an earlier file set up. The
  multi-system fixture therefore lives in a **describe-scoped** `beforeEach`,
  which mocha runs after all root hooks. Do not move it.
- `msgBuffer` (duplicate filter) is a module global that **survives the schema
  rollback between tests** - reusing message text across tests gets it silently
  dropped as a duplicate. Use distinct text.
- `lib/systems.js` caches the system list; the seed calls `systemsLib.invalidate()`.
  Anything writing to `systems` must invalidate.
- Port 3000 is taken on this host by an unrelated container - run the suite with
  `PORT=3999 npx mocha --exit -t 60000`. Full run takes ~18-27 minutes (bcrypt).
- `server/test/messages.db` is a generated artifact, untracked. If a run is
  killed it can be left with a stale migration lock; `rm -f test/messages.db`
  fixes it.

---

## 8. Dev environment notes

- `server/config/config.json` is a **symlink to `/data/config.json`**, which did
  not exist. Created it with dev-scratch defaults. It points at
  `/tmp/scratch-smoke.db`, NOT live data.
- Live data lives in `/home/nathan/docker/pagermon/data/{york,dauphin,cumberland}/`
  and is **read-only for this work**. Only ever copy from it. The three live
  containers were never restarted.
- Standing practice: prefer no-restart changes; confirm before restarting or
  hand-editing live config.

### Rebuilding a throwaway test instance

No test instance exists - the one used for browser verification was torn down,
along with its data copy, its image and all `/tmp` database copies. To stand a
new one up:

1. `docker build -t pagermon-server:multisystem-test server/`
2. New directory outside the live tree, e.g. `~/docker/pagermon/test-x/data/`;
   copy a live `messages.db` and `config.json` into it.
3. **Neutralise the copied config before starting it**: set every
   `plugins.*.enable` to false and empty `readerHealth.destinations`/`monitors`.
   A copied production config has live Discord/SMTP credentials and *will* send
   real notifications otherwise.
4. Compose file: own container name, own port, `volumes: ./data:/data`,
   `restart: "no"`, and **`SECURE_COOKIES=false`** - a copied config's `siteUrl`
   is https, so cookies would be marked `secure` and a browser would not send
   them over plain http. That presents as "Invalid or missing CSRF token" at
   login and is not a bug in the app.
5. For a known admin login, insert a user with a `bcryptjs` hash directly into
   the copied database rather than touching real accounts' hashes.

Anything built this way holds real message content and real usernames - delete
the directory, the image and any `/tmp` copies when finished.

---

## 9. What was browser-verified

Operator confirmed working in Firefox against the test instance: system column
and selector, filtering by system, persistence across reload, live socket
updates filtered by system, pagination, search, popover, all four themes, and
the admin pages. Compact Dark shows seconds; the other three do not (the
original plan claimed both Compact themes did - it was wrong; only Compact Dark).

---

## 10. Next steps

### Immediate

**Phase 6B — `pagermon-import`.** Full design in
`~/.claude/plans/multi-system-phase-6-consolidation.md`. Summary:

- A command in `server/`, run with the instance **stopped**, source opened
  read-only, target written in one transaction.
- **Two-step `plan` → review → `apply`**, because user merging cannot be
  automatic. Measured against the live data: `mertel` is one person with
  *different emails* per instance; `n.kenyon@me.com` is one person with *two
  usernames* (`fozzy`/`fozziebear`). Neither username nor email alone is a safe
  join key. `apply` refuses to run while any user is flagged `REVIEW`.
- On merge the **existing account wins** (password, role, status). Merged users
  therefore keep one password and everyone else must use "forgot password" -
  tell people in advance. Roles are never escalated by import.
- Import: `capcodes` (new ids, `old_id → new_id` map), then `messages`
  (`alias_id` remapped, `system_id` set). Never import `sessions`,
  `user_tokens`, `reader_health*`, `knex_migrations`, or `config.json`.
- Dedupe on `(system_id, address, timestamp, message)` so imports are
  **re-runnable** and safe to overlap with live forwarding.
- Wildcard addresses (`013044_`) copied verbatim - `_` is a LIKE wildcard.
- `--dry-run` runs the whole transaction and rolls back.

**Open questions the operator has not yet answered** (asked, not yet decided):
1. Should `apply` support importing into an *existing* system, or only a fresh one?
2. Do they want `--reset-passwords` forcing merged users through "forgot
   password" (more honest, needs working SMTP at cutover)?
3. Archive retention for the three old containers?

### Deferred

- **6A-ii bulk alias reassignment** - tabled by the operator. Only needed for
  splitting already-imported aliases or repairing a wrong-system import.
- **6C rollout runbook** - `server/docs/consolidating-instances.md`. Includes the
  **breaking change**: the three hostnames do not survive consolidation. The
  operator's transition uses the **MessageRepeat** plugin on each old instance
  (`repeatURI` → new host, `repeatAPIKEY` → that system's key, `repeatUUID` →
  loop guard) to forward live traffic during a proof-of-concept period. Note the
  operator considers this an anomaly; most users will migrate via alias CSV
  import, which already works.

### Before merging to `main`

- Decide the release version and write release notes carrying the **upgrade
  note** already in `CHANGELOG.md` (one-time backfill at first boot; do not kill
  the container; raise healthcheck start period).
- Live rollout needs `auth.keys` entries adding a `system` field in each
  bind-mounted `config.json`, per instance.

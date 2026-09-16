# Consolidating existing PagerMon instances

Multi-system PagerMon can consolidate several existing instances into one new
instance while retaining aliases, message history and user accounts. Each old
`messages.db` becomes one target paging system.

This guide is written for a Docker deployment. Read
[Upgrading to multi-system PagerMon](multi-system-upgrade.md) first if the target
image has not yet been upgraded and tested as a normal one-system instance.

> **Breaking change:** consolidation retires the old per-instance hostnames.
> Update reader configuration, bookmarks, reverse-proxy entries, integrations
> and notification links before old instances are stopped. Previously sent links
> to an old hostname will not resolve once that hostname is retired.

## What the importer reads

A PagerMon `messages.db` contains more than messages. The importer reads only:

| Source data | Treatment |
| --- | --- |
| `capcodes` | Copied to the target system with new local ids. Existing aliases with the same `(system, address)` are retained by default. |
| `messages` | Copied with original address, message, source and timestamp. Alias ids are remapped to the copied capcodes. Unmatched messages remain unmatched but receive the target `system_id`. |
| `users` | Created, merged or skipped according to the reviewed plan. |

It never imports sessions, rate-limit/protection scratch data, user tokens,
reader-health tables, migration tables or `config.json`.

Wildcard capcodes such as `013044_` are preserved exactly.

## User merge rules

User matching is deliberately reviewed rather than fully automatic:

1. same email, case-insensitive: suggested **merge**;
2. same username and same email: suggested **merge**;
3. same username but different email: **REVIEW**;
4. no match: suggested **create**.

A plan cannot be applied while any user remains `REVIEW`. Change each reviewed
entry to `merge`, `create` or `skip`.

On merge, the existing target account wins: its password, role and status remain
unchanged. The source password hash is discarded and roles are never escalated.
A newly created user retains the source password hash.

### Password communication for users

The importer does **not** reset passwords or send email. Tell users this before
cutover:

- If an account is newly created by the first import, the password from that
  original instance becomes its active password on the consolidated instance.
- If the same person is merged from a later import, their password from that
  later/original instance is discarded. The active password remains the one on
  the target account — normally the password from the first instance imported
  for that person.
- A user who does not know that active password must use the normal
  forgot-password process after cutover, provided the target has password reset
  and SMTP configured.

This is deliberate: silently replacing an existing password hash would be
surprising, difficult to audit, and could overwrite the credentials the person
is already using on the target.

## Before the rehearsal

1. Back up every old instance's complete data directory. At minimum preserve:
   - `messages.db`
   - `config.json`
2. Build and start a **new, separate** multi-system target instance. Do not point
   it at any old instance's bind-mounted data directory.
3. Disable plugins and real notification destinations in the rehearsal target.
   A copied production config can contain Discord, SMTP and other live
   credentials.
4. Copy source databases; do not move them and never use a live DB as the target.

For a consistent source copy, stop the old container briefly before copying its
SQLite DB, or use SQLite's backup command while it is running. A plain filesystem
copy made during active SQLite writes may not be a consistent snapshot:

```sh
# Run against the old container; writes a new file, never modifies messages.db.
docker exec <old-container> sqlite3 /data/messages.db ".backup '/data/messages.db.consolidation-copy'"
docker cp <old-container>:/data/messages.db.consolidation-copy ./imports/york/messages.db
```

Store the copied files in the new target's bind-mounted data directory, for
example:

```text
/data/imports/york/messages.db
/data/imports/dauphin/messages.db
/data/imports/cumberland/messages.db
```

These source paths are local to the target container.

## Rehearse each source import

1. Open **Admin → Imports** on the new target.
2. Enter the source path and the desired target system name.
3. Click **Analyze**.
4. Review source counts, duplicate estimate and all proposed user actions.
5. Resolve every `REVIEW` user deliberately.
6. Click **Save reviewed plan**.
7. Click **Dry run**.

Dry run performs the complete import transaction, then rolls it back. It does
not permanently create a system, aliases, messages or users.

Repeat for every source database. Import order matters only for merged users:
the first existing/created target account's password becomes the password kept
for later merges.

## Apply imports

After the rehearsal is accepted:

1. Confirm the target has a current backup.
2. Open each reviewed import job and click **Enter maintenance mode and apply**.
3. Wait for status `succeeded` before applying the next source.
4. Do not post messages or make admin changes while a job is running. PagerMon
   blocks API writes during import maintenance mode; read-only browsing and job
   status remain available.
5. For SQLite targets, PagerMon creates a sibling backup named similar to:

   ```text
   messages.db.bak-pre-import-2026-...
   ```

Apply is transactional per source: failure rolls back that source's database
changes. The source fingerprint is checked immediately before apply; if the
source changed after Analyze, make a new plan from a fresh consistent copy.

Imports are re-runnable. Existing aliases are matched by `(system_id, address)`;
messages already present with the same `(system_id, address, timestamp, message)`
are skipped. This allows safe recovery from interruption and overlap with the
forwarding proof of concept below.

## Verify before forwarding/cutover

For every imported system, verify:

- expected alias and message counts;
- known duplicate addresses across two systems resolve to the correct alias in
  each system;
- wildcard aliases work;
- unmatched traffic is visible under the correct system;
- message search works;
- the message-list system selector isolates systems correctly;
- aliases appear under the correct system in Admin → Aliases;
- expected users can sign in, or have a documented reset path.

A useful SQLite inspection on the new target is:

```sh
sqlite3 /data/messages.db '
  SELECT s.name, COUNT(m.id) AS messages
  FROM systems s LEFT JOIN messages m ON m.system_id = s.id
  GROUP BY s.id, s.name ORDER BY s.sortorder, s.name;
'
```

## Configure live ingest

Create one API key per target system in Admin → Settings. Assign each key to its
System, then test that a message sent with that key lands in the intended system.

Do not reuse old reader keys blindly: configurations and keys are not imported.
The new instance's `config.json` is the source of truth for keys, plugins,
replacement rules, reader-health destinations and monitor name. Reconcile these
settings by hand from the old configs.

## Reversible forwarding proof of concept

Before repointing radios/readers, run old and new instances in parallel long
enough to validate the result. There are two supported ways to forward live
traffic; choose one per reader so the same decoded page is not sent twice.

### Preferred: client fan-out

The PagerMon client can post each decoded page directly to several server
instances. Configure its `destinations` list with both the old server key and a
new server API key assigned to the matching target system. See
[client fan-out configuration](../../client/README.md#send-decoded-pages-to-several-servers).

Each destination retries independently, so an unreachable new server does not
interrupt delivery to the old instance. Removing the new destination rolls the
proof of concept back without changing the old server.

### Alternative: MessageRepeat on the old server

For readers that cannot yet run the updated client configuration, configure
MessageRepeat on each old instance:

```text
repeatURI    = https://<new-host>/api/messages
repeatAPIKEY = API key assigned to that old instance's target system
repeatUUID   = unique value for that old instance (loop guard)
```

MessageRepeat forwards address, message, source and timestamp. Keep each old
instance's key assigned to the matching new system. Disable MessageRepeat to
stop forwarding.

The importer's message duplicate rule handles historic/import overlap.

## Cutover

1. Tell users the new hostname and password-reset expectations.
2. Update DNS/reverse proxy/TLS for the new hostname.
3. Repoint each reader to the new host and its new assigned API key.
4. Confirm the new instance receives messages from every reader.
5. Disable MessageRepeat on the old instances.
6. Stop old containers; do not delete their data directories yet.
7. Retain old data directories as operator-managed archives for an agreed
   retention period.

## Old-instance archives

PagerMon does **not** archive, export or delete old instances automatically.
That is an operational decision because the old directories contain real message
history, user data and configuration secrets.

Recommended initial policy:

1. Stop old containers after cutover and set `restart: "no"` (or otherwise
   ensure they cannot come back accidentally).
2. Remove old hostnames from the reverse proxy/DNS once the transition is
   accepted.
3. Keep the old data directories as read-only/operator-managed archives for an
   initial period such as 90 days.
4. At the end of that period, decide whether to retain an encrypted backup or
   delete the old directories according to local retention and security policy.

## CLI fallback

The Admin UI is the normal interface. The same engine is available inside the
container for recovery or scripted use:

```sh
cd /app
node import-instance.js plan \
  --source /data/imports/york/messages.db \
  --system York \
  --out /data/imports/york.plan.json
node import-instance.js apply --plan /data/imports/york.plan.json --dry-run
node import-instance.js apply --plan /data/imports/york.plan.json
```

The UI and CLI both use `server/lib/importer`, so plan/apply behavior is the
same.

## Recovery

If an import fails, review its error/status in Admin → Imports. A failed apply
rolls back its transaction; correct the issue and rerun Analyze/Apply from the
same or a fresh source copy.

If a broader recovery is needed, stop the target container and restore its
pre-import backup. Never overwrite a running SQLite database.

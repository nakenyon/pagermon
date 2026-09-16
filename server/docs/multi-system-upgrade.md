# Upgrading to multi-system PagerMon

This release adds a first-class **system** to PagerMon. A paging address is only
unique inside one paging network, so aliases and messages are now assigned to a
system. This allows one PagerMon instance to receive traffic from several
networks without an address on one network resolving to an alias from another.

This document covers a normal upgrade of one existing instance. If you are
combining several instances, read [Consolidating existing instances](consolidating-instances.md)
after completing the upgrade rehearsal.

## Before upgrading

1. Back up the entire PagerMon data directory, including at least:
   - `messages.db`
   - `config.json`
2. Ensure the container is allowed enough startup time. The upgrade performs a
   one-time backfill of `messages.system_id` and `capcodes.system_id`.
3. Do **not** stop or kill the container while its database migration is in
   progress. SQLite migrations are transactional, but an interrupted migration
   will have to run again on the next start.
4. If you use a Docker healthcheck/startup deadline, increase its start period
   for the first start after upgrading.

On a measured 47,942-message SQLite database the migration completed in about
0.30 seconds. Time grows with retained message count and storage speed, so plan
for more time on larger/slower installations.

## What the upgrade changes

The migration creates a `systems` table and adds `system_id` to `messages` and
`capcodes`.

Every existing installation is made a valid one-system installation:

- one enabled default system is created;
- its name/label comes from `global.monitorName` (or `Default` if unset);
- all existing aliases and messages are assigned to that default system.

There is no expected change to normal single-system operation.

## First start and verification

1. Deploy the new image and start the container normally.
2. Watch logs until database upgrades complete:

   ```sh
   docker compose logs -f pagermon-server
   ```

   The exact service name may differ in your compose file.

3. Log in to Admin → Systems. Confirm there is one default system named for the
   instance.
4. Confirm existing aliases and historic messages are visible.
5. Post or wait for one normal reader message and confirm it appears as usual.

For a SQLite database, optional direct checks inside the container are:

```sh
sqlite3 /data/messages.db '
  SELECT id, name, is_default FROM systems;
  SELECT COUNT(*) AS aliases_without_system FROM capcodes WHERE system_id IS NULL;
  SELECT COUNT(*) AS messages_without_system FROM messages WHERE system_id IS NULL;
'
```

Both `*_without_system` values must be zero.

## Assign systems to reader keys

Until an API key is assigned to a system, it deliberately posts into the default
system. This preserves ingest compatibility immediately after upgrade.

To configure multi-system ingest:

1. Create each system in Admin → Systems.
2. In Admin → Settings, assign each reader/API key a System.
3. Save Settings.
4. Send a test message through each reader and verify its system badge and alias.

For hand-managed `config.json`, a key may carry a system name:

```json
{
  "name": "york-reader",
  "key": "replace-with-secret",
  "system": "York"
}
```

The system name, rather than database id, is used so the configuration remains
readable and portable.

A shared key can optionally permit source-based selection among named systems:

```json
{
  "name": "shared-reader",
  "key": "replace-with-secret",
  "system": "Dauphin",
  "allowSourceOverride": true,
  "systems": ["Dauphin", "Cumberland"]
}
```

Without `allowSourceOverride`, an incoming request's `source` never changes the
system selected by the key.

## Display changes

- The message list displays a System badge and offers a system filter once more
  than one enabled system exists.
- The selection is a browser cookie/view preference, not an access-control
  boundary. All viewers retain the visibility they had before.
- Source is hidden from the message table by default because System is normally
  the useful operator-facing value. Admin → Settings → **Show Source** restores
  the reader/source column when needed.

## Rollback and recovery

Do not restore a backup over a running container.

If the upgraded instance is unhealthy:

1. Stop the container.
2. Preserve the failed data directory for investigation.
3. Restore `messages.db` and `config.json` from the pre-upgrade backup into the
   data directory.
4. Start the previous known-good image.

The migration rollback intentionally does not remove the added SQLite columns;
restoring the pre-upgrade database is the clean recovery path.

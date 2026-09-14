# Reader inactivity monitoring

Reader Health detects a silent reader while PagerMon remains operational. It is
independent of aliases, message retention, message-notification plugins, and any
future multi-system support. **Disabled by default.**

## Configure

1. Upgrade PagerMon after backing up its database and configuration. The upgrade
   adds three small health tables; it does not modify existing paging messages.
   Deployment requires a server restart. No reader changes are required.
2. Give each reader a separate API key under **Admin → Settings → API Keys**.
   Two readers sharing a key share a timer: one can mask failure of the other.
3. Under **Reader Health**, add named notification destinations:
   - **Email:** select PagerMon users with email addresses. Configure and enable
     the general **Email** settings above (not the SMTP paging plugin). A Site
     URL is not required for these text-only operational emails.
   - **Pushover:** application API token and user/group key. Sends normal-priority
     notifications, without Pushover emergency-repeat behavior.
   - **Telegram:** bot token and chat ID. The bot must be allowed to post there;
     for private chats, the user must first start the bot. Plain text is used.
   - **Discord:** HTTPS Discord webhook URL. Mentions are disabled.
4. Save, then click **Send test notification**. Tests go to the actual selected
   destination/recipients and do not change monitor state. A success means the
   provider accepted the notification, not a guarantee that a human read it.
5. Enable monitoring for the desired keys. Select outage/recovery destinations.
   The default timeout is **360 minutes (six hours)**. The allowed range is
   1–43200 minutes; use a short timeout only for testing.
6. Optionally select **Additional recovery emails**. All outage destinations
   already receive recovery notifications. Email recipients are deduplicated by
   address when the incident is opened, including overlapping destinations.
7. Save. Use **Refresh health status** to inspect last receipts, incidents and
   delivery attempts. Status is not automatically polled by the settings page.

The shared settings panel is available in all four bundled themes. Selection of
multiple recipients/destinations uses the browser's Ctrl/Cmd-click convention.

## What counts as activity

A successfully API-key-authenticated `POST /api/messages` with a nonblank string
message and a valid address (nonblank string or positive finite numeric legacy
address). Receipt is recorded **before duplicate, alias-ignore and plugin
filters**, using the server clock, not the reader-provided timestamp. Messages
that have no matching alias count too.

API reads, invalid authentication, malformed payloads and session-admin message
submissions do not reset a reader timer. A valid arrival still counts if later
message processing fails: this monitors the reader's ability to reach PagerMon,
not the complete message storage/notification pipeline.

## Timing and lifecycle

- Each newly enabled/re-enabled monitor gets a full grace period. There is no
  backfill from historical messages: they do not identify the submitting key.
- Checks run every minute. An incident opens on the first successful check
  **after** the timeout is exceeded. Slow notification providers do not block
  subsequent checks or incoming paging messages.
- Each incident has one logical outage notification per destination. There are
  no periodic outage reminders. Valid messages close it and queue recovery.
- State and pending notifications survive server restarts; a restart does not
  grant a new grace period. If PagerMon was itself stopped, it can only evaluate
  inactivity after starting again.
- Key IDs are persisted separately from key names/secrets. Rename and rotate the
  secret within the same entry to preserve monitoring history. Deleting and
  recreating an entry starts a new identity. API-key authorization is unchanged.
- Disabling/deleting a monitor cancels unsent work and closes the incident as
  `disabled`, not as a recovery. A send already accepted or in flight cannot be
  recalled.
- Recipients are snapshotted as user/destination IDs when an incident opens.
  Editing selections applies to future incidents, not a resend of the current
  outage. Current user email addresses and destination credentials are resolved
  at delivery time. Deleted users/destinations are skipped. Email destinations
  are expanded to user IDs at incident creation; deleting that email destination
  alone does not revoke those snapshotted users. Disable monitoring to cancel
  outstanding work for the incident.
- Recovery cancels unsent stale outage retries. Recovery summaries include outage
  delivery statuses, so recipients can tell if the original alert failed. An
  in-flight outage completes before recovery to that same destination.

## Delivery failures and monitoring errors

Deliveries retry independently, at approximately 1, 2, 4, 8 and 16 minutes after
failure (minute scheduler granularity), with **six total attempts**. Failures on
one channel do not suppress successful deliveries on another. Exhausted attempts
remain visible as `failed`; fixing settings alone does not resend exhausted
notifications. Use the test button to verify the fix; later incidents use it.

Provider calls have timeouts. A `sending` delivery left by a crash can be reclaimed
after five minutes. There is an unavoidable at-least-once delivery edge case:
provider acceptance followed by a crash before the database acknowledgment may
produce a duplicate on retry.

Health database failures do not reject valid paging messages. The server records
a monitoring error, retains the latest failed receipt per key in memory, and
retries it with its **original** receipt time. Until those writes succeed, it
suppresses new outage inference from known-stale state. These fallback receipts
cannot survive a crash while the database is unavailable. The admin status
reports monitoring errors separately; repaired storage is checked again each
minute. If startup failed before scheduling, fix the logged initialization error
and restart.

## Security and deployment

- Management/status/test endpoints require an **administrator session**. Ingest
  API keys cannot directly use them. Normal users have no destination settings.
  PagerMon's pre-existing API keys remain admin-capable elsewhere; this feature
  does **not** turn them into restricted ingest-only credentials.
- Generic settings writes involving health configuration also require an admin
  session and CSRF token. Thus older API-key configuration scripts cannot alter
  settings once health configuration exists. Angular handles the CSRF token.
- Credentials are masked on settings responses and retained when the masked
  value is saved. Replace a field to rotate a credential; remove the destination
  to delete its credentials. Credentials remain plaintext in server configuration
  and its backup: protect both files and backups. They are not placed in health
  tables, notification bodies or transport error logs.
- Settings saves preserve Docker's symlink from `config/config.json` to the
  persistent `/data/config.json` target. Back up the actual target, not merely the
  symlink. For SQLite, use a consistent backup including any WAL state.
- Supported ownership model: **one PagerMon process per database**. Multiple
  concurrent server processes sharing a database are not supported by this
  worker. Separate instances with separate databases are independent.
- Downgrading code without dropping the additive tables preserves health history.
  An older server will not run health monitoring. Do not roll back the migration
  unless you intend to discard health state and delivery history.

This is message-inactivity detection, not a heartbeat. Genuinely quiet networks
can trigger it. It cannot alert while the PagerMon server, database, outbound
network or all notification providers are unavailable; use an external uptime
monitor for those failures.

## Verification

Automated coverage includes clock boundaries, independent keys, filtered and
unmatched receipts, state/retry persistence, concurrent checks and receipts,
slow providers, recovery ordering, configuration validation, authorization,
CSRF, secret redaction, Docker symlinks, and mocked HTTP provider contracts.

Run tests **only in a scratch copy**: the existing suite rewrites
`config/config.json`, migrates `test/messages.db`, and opens an HTTP listener.
From that scratch server directory: `NODE_ENV=test PORT=3197 npm test`.

Email, Pushover, Telegram and Discord transports are mocked in automated tests;
no real notification is sent. All channels still require manual end-to-end
verification with your own credentials. Telegram specifically has not been
live-verified. Browser interaction across all themes also needs manual checking.

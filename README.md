# auto-ugid

`auto-ugid` monitors the relay domain returned by the UGLink API, validates a
new domain against a strict alias-specific allowlist, confirms it with a second
query, verifies the Emby Server ID, and then sends a signed event to a Hermes
Webhook route. No-change checks are silent.

This repository contains the monitor and deployment examples only. It does not
create the Hermes route, change a NAS container, or deploy production secrets.

## Safety gates

A candidate is committed only when all of these checks pass:

1. The UGLink API returns a domain.
2. The domain matches `<alias>.cn<digits>.ug.link` exactly.
3. A second query after `CONFIRMATION_DELAY` returns the same domain.
4. `https://<domain>/emby/System/Info/Public` returns valid JSON with `Id`,
   `ServerName`, and `Version`.
5. The returned `Id` matches the persisted Emby Server ID baseline.

The first healthy run establishes the domain and Server ID baseline without a
notification by default. A legacy `/app/last_domain.txt` value can be imported,
but its current Emby endpoint must establish the Server ID before any change is
accepted.

## Configuration

| Variable | Required | Default | Purpose |
|---|---:|---:|---|
| `UG_ID` / `UGID` | No | `bmnd` | UGLink alias and domain allowlist prefix |
| `HERMES_WEBHOOK_URL` | Yes | — | Hermes `/webhooks/<route>` URL |
| `HERMES_WEBHOOK_SECRET` | Yes | — | Route-specific HMAC secret |
| `CHECK_INTERVAL` | No | `600` | Check interval in seconds, minimum 30 |
| `CONFIRMATION_DELAY` | No | `20` | Delay before the confirmation query |
| `REQUEST_TIMEOUT` | No | `10` | HTTP timeout in seconds |
| `SOURCE_FAILURE_THRESHOLD` | No | `3` | Consecutive source failures before one alert |
| `NOTIFICATION_MAX_ATTEMPTS` | No | `5` | Maximum Hermes delivery attempts |
| `NOTIFICATION_BACKOFF` | No | `30` | Initial retry backoff in seconds |
| `NOTIFY_ON_FIRST_RUN` | No | `false` | Send a first-baseline event when `true` |
| `STATE_DIR` | No | `/data` | Persistent state and audit directory |
| `LEGACY_DOMAIN_FILE` | No | `/app/last_domain.txt` | Old domain file import location |
| `UGLINK_API_URL` | No | UGLink production API | Override for testing only |

`WEBHOOK_URL` remains a deprecated alias for `HERMES_WEBHOOK_URL` during
migration. It is treated as a Hermes endpoint, not as a direct WeCom robot URL.
Do not configure both or expect dual delivery.

Secrets must be injected through the container environment or another managed
credential store. Never commit them to Compose, logs, or documentation.

## Hermes route

The sender follows Hermes generic Webhook HMAC V2:

- `X-Webhook-Timestamp`: Unix seconds;
- `X-Webhook-Signature-V2`: lowercase hex HMAC-SHA256 of
  `<timestamp>.<exact JSON body>`;
- `X-Request-ID`: stable `event_id` used across retries.

This matches the current Hermes implementation in
[`gateway/platforms/webhook.py`](https://github.com/NousResearch/hermes-agent/blob/main/gateway/platforms/webhook.py).
The timestamp must be within Hermes' replay window, so the NAS and Hermes hosts
must have synchronized clocks.

An example Hermes-side route is shown below for review. Creating it is a
separate production operation and is not performed by this repository:

```yaml
platforms:
  webhook:
    enabled: true
    extra:
      port: 8644
      routes:
        uglink-status:
          secret: "<route-specific-secret>"
          deliver: "weixin"
          deliver_only: true
          prompt: "{message}"
```

If the Weixin home channel is not the desired recipient, configure the
appropriate `deliver_extra.chat_id` on the Hermes side.

## Persistent files

Mount `/data` persistently. The monitor maintains:

- `/data/state.json`: committed domain, Server ID, failure and alert state;
- `/data/events.jsonl`: append-only event summaries without credentials;
- `/data/pending-notifications.json`: bounded notification retry queue.

JSON snapshots are written through a temporary file, `fsync`, and atomic
rename. A corrupt state or pending file is preserved with a `.corrupt-<time>`
suffix before a safe empty structure is used.

## Local development

Node.js 24 LTS is used by the container and CI. The runtime has no third-party
dependencies.

```bash
npm test
npm run lint
npm run start -- --help
docker build -t auto-ugid:test .
```

Tests use mocks and do not contact the real UGLink API, Emby, or Hermes.

## Compose example

Review `docker-compose.yaml`, then provide the secret without writing it into
the file:

```bash
export HERMES_WEBHOOK_SECRET='replace-with-managed-secret'
docker compose config
docker compose up -d
```

Those commands are deployment instructions only. They have not been run on the
NAS by this development change.

## Upgrade and migration

1. Back up the current Compose file and `/app/last_domain.txt` from the old
   container before replacement.
2. Prepare a persistent host directory for `/data`.
3. To retain the old domain baseline, copy `last_domain.txt` to a protected host
   path and mount it read-only at `/app/last_domain.txt` for the first start, or
   start fresh and let the current healthy Emby instance establish a baseline.
4. Configure the Hermes route and secret separately, then send a controlled test
   event before replacing the production container.
5. Start the new container and verify that `state.json` contains the expected
   domain and Server ID. With `NOTIFY_ON_FIRST_RUN=false`, baseline creation is
   silent.
6. Verify no-change silence, one failure alert plus one recovery alert, and
   restart recovery before considering the deployment complete.

Do not reuse an old direct WeCom robot URL as the Hermes endpoint.

## Rollback

1. Stop the new container.
2. Restore the backed-up Compose configuration and previous image tag or digest.
3. Restore the old `last_domain.txt` if the previous image requires it.
4. Keep the new `/data` directory for investigation; the old version does not
   need to consume it.
5. Start the previous container and independently verify its current behavior.

Rolling back code does not prove that UGLink, Emby, Hermes, or Weixin delivery is
healthy; verify each relevant production link separately.

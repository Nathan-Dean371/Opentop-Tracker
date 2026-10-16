# Security review

**Review date:** 2026-10-16

**Scope:** Static review of tracked application code and configuration for risks relevant to making this repository public.

## Findings

### High — Default administrator credentials

[`server.js`](./server.js) falls back to the known username `admin` and password `opentop123` when `ADMIN_USERNAME` or `ADMIN_PASSWORD` is unset (lines 23–24). A deployment missing either variable can expose the admin panel and protected write endpoints to anyone who knows the defaults.

**Recommendation:** Require explicit administrator credentials in production and fail startup if either is missing. Keep any local-development defaults isolated from production.

### Medium — Unauthenticated OwnTracks location ingestion

The public `POST /owntracks` endpoint in [`server.js`](./server.js) passes submitted payloads directly to location ingestion without authenticating the sender (lines 540–556). A caller can submit coordinates for a tracker's `tid`, potentially forging its displayed location and ETA.

**Recommendation:** Authenticate webhook submissions or restrict the endpoint to a trusted, authenticated source.

### Medium — MQTT TLS certificate verification disabled by default

[`server.js`](./server.js) defaults `MQTT_TLS_REJECT_UNAUTHORIZED` to `false` (line 99), and passes that value to the MQTT client (lines 453–471). If MQTT over TLS is configured, this permits connections without validating the broker certificate, enabling an active network attacker to impersonate the broker, capture credentials, or inject location messages. The README also documents this insecure default.

**Recommendation:** Enable certificate verification by default and configure trusted certificates for private CAs as needed.

## Public-release notes

No live credential material was identified in tracked files or reachable commit history during this review. This is a static review and does not establish that deployed environments are configured safely. Address the findings before relying on a public deployment; making the repository public alone does not mitigate the runtime issues above.

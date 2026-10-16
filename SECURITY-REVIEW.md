# Security review

**Review date:** 2026-10-16

**Scope:** Static review of tracked application code and configuration for risks relevant to making this repository public.

## Findings

### High — Default administrator credentials

[`server.js`](./server.js) falls back to the known username `admin` and password `opentop123` when `ADMIN_USERNAME` or `ADMIN_PASSWORD` is unset (lines 23–24). A deployment missing either variable can expose the admin panel and protected write endpoints to anyone who knows the defaults.

**Recommendation:** Require explicit administrator credentials in production and fail startup if either is missing. Keep any local-development defaults isolated from production.

### Medium — Unauthenticated OwnTracks location ingestion

When `OWNTRACKS_HTTP_ENABLED=true`, the `POST /owntracks` endpoint in [`server.js`](./server.js) accepts submissions without authenticating the sender. A caller can submit coordinates for a tracker's `tid`, potentially forging its displayed location and ETA. HTTP ingestion is disabled by default; the risk applies whenever the endpoint is enabled.

**Recommendation:** Leave HTTP ingestion disabled when devices use MQTT. If HTTP ingestion is needed, authenticate webhook submissions or restrict the endpoint to a trusted, authenticated source.

### Medium — MQTT TLS certificate verification disabled by default (addressed)

Previously, [`server.js`](./server.js) defaulted `MQTT_TLS_REJECT_UNAUTHORIZED` to `false`, which permitted connections without validating the broker certificate and enabled an active network attacker to impersonate the broker, capture credentials, or inject location messages.

**Resolution:** Verification is now on by default, and `MQTT_CA_CERT` lets the backend trust a private CA. Deployments using a self-managed CA must set `MQTT_CA_CERT` (public `ca.crt` only) before upgrading, otherwise the broker connection will be rejected. A warning is logged if verification is explicitly disabled.

## Public-release notes

No live credential material was identified in tracked files or reachable commit history during this review. This is a static review and does not establish that deployed environments are configured safely. Address the findings before relying on a public deployment; making the repository public alone does not mitigate the runtime issues above.

# Mosquitto Setup for OpenTop

This folder contains production-oriented templates for running an MQTT broker for OwnTracks migration.

## Files

- mosquitto.conf: TLS + password-auth configuration template.
- passwords.example: Placeholder format for password file entries.

## Railway Volume Mount (Single Mount)

If Railway allows only one volume mount location, mount the volume at:

- /mosquitto

Then keep these subfolders in that mounted path:

- /mosquitto/config
- /mosquitto/data
- /mosquitto/log
- /mosquitto/certs

The provided mosquitto.conf is already aligned to this layout.

## Create Real Password File

Run these commands in the Mosquitto service/container:

1. mosquitto_passwd -c /mosquitto/config/passwords owntracks_device
2. mosquitto_passwd /mosquitto/config/passwords opentop_backend

Use a strong password for each account.

## TLS Certificates

You have two practical options:

- Option A (recommended): Use a publicly trusted certificate for your MQTT hostname.
- Option B (quick start): Use your own CA and distribute ca.crt to clients.

Important:

- The certificate hostname must match the broker host used by devices and by MQTT_BROKER_URL.
- With single volume mount at /mosquitto, keep all cert files under /mosquitto/certs.

### Option B: Generate self-managed certs inside the Mosquitto service

Run these in the broker container shell:

1. Create cert folder
	mkdir -p /mosquitto/certs

2. Generate CA key and cert
	openssl genrsa -out /mosquitto/certs/ca.key 4096
	openssl req -x509 -new -nodes -key /mosquitto/certs/ca.key -sha256 -days 3650 -out /mosquitto/certs/ca.crt -subj "/CN=OpenTop MQTT CA"

3. Generate server key and CSR (replace broker.example.com)
	openssl genrsa -out /mosquitto/certs/server.key 2048
	openssl req -new -key /mosquitto/certs/server.key -out /mosquitto/certs/server.csr -subj "/CN=broker.example.com"

4. Add SAN extension file (must include your real broker host)
	echo "subjectAltName=DNS:broker.example.com" > /mosquitto/certs/san.ext

5. Sign server cert with your CA
	openssl x509 -req -in /mosquitto/certs/server.csr -CA /mosquitto/certs/ca.crt -CAkey /mosquitto/certs/ca.key -CAcreateserial -out /mosquitto/certs/server.crt -days 825 -sha256 -extfile /mosquitto/certs/san.ext

6. Lock down permissions
	chmod 600 /mosquitto/certs/server.key /mosquitto/certs/ca.key
	chmod 644 /mosquitto/certs/server.crt /mosquitto/certs/ca.crt

7. Verify files exist
	ls -la /mosquitto/certs

8. Ensure mosquitto.conf points to:
	cafile /mosquitto/certs/ca.crt
	certfile /mosquitto/certs/server.crt
	keyfile /mosquitto/certs/server.key

9. Restart broker service.

### Client trust for self-managed CA

- OwnTracks clients must trust /mosquitto/certs/ca.crt.
- Backend Node client can also be configured with CA trust if required by your broker policy.

### Quick verification

From a shell with MQTT tools:

1. TLS handshake check
	openssl s_client -connect broker.example.com:8883 -servername broker.example.com -showcerts

2. Broker auth check
	mosquitto_sub -h broker.example.com -p 8883 -u opentop_backend -P YOUR_PASSWORD -t '$SYS/#' --cafile /path/to/ca.crt

If handshake fails, re-check hostname in certificate SAN and broker URL.

## App Environment Variables

Set these on the Node service:

- MQTT_BROKER_URL=mqtts://<broker-host>:8883
- MQTT_TOPIC=owntracks/+/+
- MQTT_CLIENT_ID=opentop-backend
- MQTT_USERNAME=opentop_backend
- MQTT_PASSWORD=<backend-password>
- MQTT_KEEPALIVE_SECONDS=60
- MQTT_RECONNECT_PERIOD_MS=5000
- MQTT_CONNECT_TIMEOUT_MS=30000
- MQTT_CLEAN_SESSION=false
- MQTT_TLS_REJECT_UNAUTHORIZED=false (set true when using trusted cert chains)

When MQTT_BROKER_URL is empty, app stays in HTTP-only mode.

## Rollout Guidance

Keep HTTP /owntracks enabled while moving devices to MQTT.
Use migration telemetry endpoints to confirm source:

- /api/trackers
- /api/admin/ingestion

## Troubleshooting: Container Exits With Missing mosquitto.conf

If logs show:

- Error: Unable to open config file /mosquitto/config/mosquitto.conf

This means your mounted volume path is empty and is masking the image default config.

### Fast Recovery (Railway UI)

1. Keep volume mount path at /mosquitto/config.
2. In the broker service Files or Upload area, upload [deploy/mosquitto/mosquitto.conf](deploy/mosquitto/mosquitto.conf) into /mosquitto/config as mosquitto.conf.
3. Create password file in the same folder named passwords.
4. If you are not ready for TLS yet, temporarily comment out cafile, certfile, and keyfile in mosquitto.conf so the broker can start and you can finish bootstrap.
5. Redeploy or restart the broker service.

### Minimal First-Start Config (No TLS, Private Network Testing Only)

Use this temporary config only while bootstrapping:

listener 1883
protocol mqtt
allow_anonymous false
password_file /mosquitto/config/passwords
log_dest stdout

After startup is stable, switch back to port 8883 + TLS paths and redeploy.

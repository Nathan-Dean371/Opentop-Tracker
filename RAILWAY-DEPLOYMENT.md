# Railway Deployment Guide

## Quick Deploy (5 minutes)

### 1. Sign Up & Connect GitHub

1. Go to [railway.app](https://railway.app)
2. Click "Start a New Project"
3. Sign in with your GitHub account
4. Grant Railway access to your repositories

### 2. Deploy the Project

1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Choose your `Opentop-Tracker` repository
4. Railway will automatically:
   - Detect it's a Node.js app
   - Run `npm install`
   - Start the server with `npm start`

### 3. Set Environment Variables (IMPORTANT!)

1. In your Railway project, click on your service
2. Go to the **"Variables"** tab
3. Add these environment variables:
   ```
   ADMIN_USERNAME=your-chosen-username
   ADMIN_PASSWORD=your-strong-password
   ```
   
   **⚠️ IMPORTANT:** Change these from the defaults!

### 4. Get Your URL

1. Go to the **"Settings"** tab
2. Under "Domains", you'll see your app URL:
   ```
   https://opentop-tracker-production.up.railway.app
   ```
3. You can also add a custom domain if you have one

### 5. Configure OwnTracks

On your mobile device running OwnTracks:

1. Open OwnTracks app
2. Go to **Settings** → **Connection**
3. Set:
   - **Mode**: HTTP
   - **URL**: `https://your-app.railway.app/owntracks`
   - **Device ID (TID)**: Your tracker ID (e.g., "AB", "bus1")

### 6. Access Your Tracker

- **Public Map**: `https://your-app.railway.app`
- **Embeddable Map**: `https://your-app.railway.app/embed`
- **Admin Panel**: `https://your-app.railway.app/admin`
  - Login with your ADMIN_USERNAME and ADMIN_PASSWORD

## Monitoring

- **Health Check**: `https://your-app.railway.app/health`
- **Railway Logs**: Available in the Railway dashboard

## Costs

- Railway free tier includes:
  - 500 hours per month
  - $5 free credit
  - Should be plenty for MVP testing

## Auto-Deployment

Once connected, Railway will automatically redeploy whenever you push to your main branch on GitHub!

## Troubleshooting

### App won't start
- Check the logs in Railway dashboard
- Verify `package.json` has correct start script

### Can't access admin panel
- Make sure you set ADMIN_USERNAME and ADMIN_PASSWORD in Railway variables
- Clear browser cache and try again
- Use incognito/private mode to test

### OwnTracks not sending data
- Verify the URL is exactly: `https://your-domain/owntracks` (no trailing slash)
- Check that OwnTracks is in HTTP mode (not MQTT)
- Ensure your device has internet connection
- Check Railway logs to see if requests are arriving

## Next Steps

For production use, consider:
- Adding a custom domain
- Setting up persistent storage (database)
- Implementing SSL cert (Railway provides this free)
- Adding monitoring/alerting

## MQTT Broker Setup (Recommended Migration Path)

Use this when migrating from HTTP OwnTracks to MQTT while keeping `/owntracks` available during rollout.

### 1) Add a Second Service for Mosquitto

1. In Railway project, click **New Service**
2. Choose **Deploy from Docker Image**
3. Image: `eclipse-mosquitto:2`
4. Name it: `opentop-mqtt`

### 2) Add a Volume to the MQTT Service

If Railway only allows one mount target, mount a single volume at:

- `/mosquitto`

Then place broker files inside subfolders:

- `/mosquitto/config`
- `/mosquitto/data`
- `/mosquitto/log`
- `/mosquitto/certs`

This works with the provided Mosquitto template config.

If you mount only `/mosquitto/config`, the broker still runs, but message persistence/logs are not persisted.

### 3) Provide Mosquitto Config and Password File

Use the templates in this repo:

- `deploy/mosquitto/mosquitto.conf`
- `deploy/mosquitto/passwords.example`

Generate your real password file with:

`mosquitto_passwd -c /mosquitto/config/passwords owntracks_device`

Then add backend credentials similarly:

`mosquitto_passwd /mosquitto/config/passwords opentop_backend`

### 4) Configure TLS (Required for Production)

In `deploy/mosquitto/mosquitto.conf`, set:

- `cafile`
- `certfile`
- `keyfile`

Point them to real cert/key files mounted in the service (for example under `/mosquitto/certs`).

### 5) Expose MQTT Port

Create a TCP endpoint for broker port `8883` in Railway so devices can connect.

### 6) Wire Node Service to Broker

In your Node service variables set:

- `MQTT_BROKER_URL=mqtts://<broker-host>:8883`
- `MQTT_TOPIC=owntracks/+/+`
- `MQTT_CLIENT_ID=opentop-backend`
- `MQTT_USERNAME=opentop_backend`
- `MQTT_PASSWORD=<backend-password>`

### 7) Keep HTTP On During Rollout

Do not disable HTTP OwnTracks endpoint until all trackers are seen via MQTT source telemetry:

- `/api/trackers`
- `/api/admin/ingestion` (admin auth required)

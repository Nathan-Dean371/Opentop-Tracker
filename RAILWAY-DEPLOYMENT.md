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

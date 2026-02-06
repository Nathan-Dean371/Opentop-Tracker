# Railway Persistent Volume Setup

This guide will help you set up a persistent volume on Railway so your routes, stops, and buses survive rebuilds/redeployments.

## Why You Need This

Without a volume:
- ❌ Routes/stops/buses deleted on every rebuild
- ❌ Lost when you push new code
- ❌ Lost when Railway does maintenance

With a volume:
- ✅ Data persists across all rebuilds
- ✅ Survives code deployments
- ✅ Survives Railway restarts/maintenance
- ✅ Only costs ~$0.25/GB/month

## Setup Instructions (5 minutes)

### Step 1: Create a Volume in Railway

1. **Go to your Railway project dashboard**
   - Open [railway.app](https://railway.app)
   - Click on your `Opentop-Tracker` project

2. **Add a Volume**
   - Click on your service (the one running the app)
   - Go to the **"Data"** or **"Volumes"** tab
   - Click **"+ New Volume"**

3. **Configure the Volume**
   - **Mount Path**: `/data` (exactly this)
   - **Name**: `opentop-data` (or any name you like)
   - Click **"Add"**

### Step 2: Set Environment Variable

1. **Still in your Railway service**, go to **"Variables"** tab

2. **Add new variable**:
   ```
   Variable Name: DATA_DIR
   Value: /data
   ```

3. **Click "Add"** to save

### Step 3: Redeploy

Railway will automatically redeploy with the new volume mounted.

Watch the deployment logs - you should see:
```
📁 Data will be stored at: /data/data.json
```

### Step 4: Verify It Works

1. **After deployment completes**, go to your admin panel
2. **Create a test route** (or your real route)
3. **Go back to Railway** → Click **"Redeploy"** (force a rebuild)
4. **Wait for deployment** to complete
5. **Check admin panel** → Your route should still be there! ✅

## What Gets Stored in the Volume

The `/data/data.json` file contains:
- All routes with waypoints
- All stops with locations
- All buses and tracker IDs
- All assignments

**File size**: Typically < 1MB even with many routes

## Cost

- Railway charges ~$0.25/GB/month for volumes
- Your data.json will be < 1MB
- **Cost: Less than $0.01/month** (essentially free!)

## Troubleshooting

### "Data not persisting after rebuild"
- Check that mount path is exactly `/data` (case-sensitive)
- Check that `DATA_DIR=/data` is set in environment variables
- Check deployment logs for: `📁 Data will be stored at: /data/data.json`

### "Permission denied" errors
- Railway handles permissions automatically
- If you see this, try redeploying

### "Volume not showing up"
- Make sure you're on a Railway plan that supports volumes
- Free tier includes volumes!

## Migration from Current Setup

If you already have routes/stops/buses in production:

### Option 1: Recreate (Simplest)
1. Set up volume (steps above)
2. Redeploy
3. Recreate your routes/stops in admin panel

### Option 2: Manual Backup/Restore
1. Before setting up volume, SSH into Railway and copy `data.json`
2. Set up volume (steps above)
3. Redeploy
4. SSH back in and restore `data.json` to `/data/`

For tomorrow's test, **Option 1 is fine** - just recreate your route after setting up the volume.

## Current Status

✅ Code is ready for Railway volumes  
✅ Falls back to local storage if no volume configured  
⏳ Waiting for you to create volume in Railway  

## Next Steps

1. **Push this code change**:
   ```bash
   git add .
   git commit -m "Add Railway volume support for persistent storage"
   git push origin main
   ```

2. **Set up volume in Railway** (steps above)

3. **Create your routes** - they'll survive forever! 🎉

---

**After setup, your data survives EVERYTHING:**
- ✅ Code deployments
- ✅ Railway restarts
- ✅ Railway rebuilds
- ✅ Environment variable changes
- ✅ Railway platform maintenance

Perfect for production! 🚀

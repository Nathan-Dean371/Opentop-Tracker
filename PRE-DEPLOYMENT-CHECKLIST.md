# Pre-Deployment Checklist for Tomorrow's Test

## ✅ Completed
- [x] Added basic authentication to admin panel
- [x] Protected all data modification endpoints (POST/PUT/DELETE)
- [x] Added health check endpoint for monitoring
- [x] Created environment variables template
- [x] Server tested and working locally

## 🚀 Before Deploying to Railway

### 1. Commit and Push Changes
```bash
git add .
git commit -m "Add authentication and Railway deployment prep"
git push origin main
```

### 2. Deploy to Railway (5 minutes)
1. Go to [railway.app](https://railway.app)
2. Sign in with GitHub
3. New Project → Deploy from GitHub repo
4. Select `Opentop-Tracker`
5. Wait for deployment (~2 minutes)

### 3. Set Environment Variables in Railway
**⚠️ CRITICAL:** Set these immediately after deployment:

1. Click your service → **Variables** tab
2. Add variables:
   ```
   ADMIN_USERNAME=your-secure-username
   ADMIN_PASSWORD=your-secure-password-here
   ```
3. Click **Redeploy** to apply changes

### 4. Note Your URLs
Once deployed, you'll get:
- **App URL**: `https://[your-app].railway.app`
- **OwnTracks endpoint**: `https://[your-app].railway.app/owntracks`
- **Admin panel**: `https://[your-app].railway.app/admin`

## 📱 OwnTracks Setup (Day of Test)

### Install and Configure
1. Install OwnTracks from App Store/Play Store
2. Open app → Settings → Connection
3. Configure:
   - **Mode**: HTTP  
   - **URL**: `https://[your-app].railway.app/owntracks`
   - **Device ID (TID)**: Choose a simple ID (e.g., "AB" or "bus1")
   - **Authentication**: None (endpoint is open for OwnTracks)
4. Enable location tracking
5. Put phone in vehicle

### Test Before Leaving
1. Open `https://[your-app].railway.app` on your computer
2. Send a test location from OwnTracks
3. Verify the marker appears on the map

## 🛣️ Route Setup (Via Admin Panel)

### Create Your Route
1. Go to `https://[your-app].railway.app/admin`
2. Login with your credentials
3. **Routes tab**:
   - Click on map to add waypoints for your route
   - Name it (e.g., "City Tour - Feb 7")
   - Choose a color
   - Click "Add Route (Road-Following)"

### Add Stops (Optional)
1. **Stops tab**:
   - Select your route
   - Click "Pick from Map" for each stop
   - Add stop names and order numbers
   - Save each stop

### Register the Bus
1. **Buses tab**:
   - Name: "Test Bus" or your bus name
   - Number: Your bus number
   - **Tracker ID**: Must match the Device ID from OwnTracks (e.g., "AB")
   - Click "Add Bus"

### Assign Bus to Route
1. **Assignments tab**:
   - Select your bus
   - Select your route
   - Click "Assign Bus to Route"

## 🧪 Testing Checklist

### Pre-Departure
- [ ] OwnTracks is connected and sending data
- [ ] Bus appears on the public map
- [ ] Route is visible
- [ ] Admin panel accessible (test login)

### During Route
- [ ] Check map periodically on phone/computer
- [ ] Verify bus position updates (every 5 seconds)
- [ ] Monitor battery level in OwnTracks

### Post-Route
- [ ] Review the full track on the map
- [ ] Check any issues in Railway logs
- [ ] Note improvements needed

## 📊 Monitoring During Test

- **Live Map**: `https://[your-app].railway.app`
- **Health Status**: `https://[your-app].railway.app/health`
- **Railway Logs**: Check dashboard for any errors

## ⚠️ Important Notes

### URLs Stay the Same
✅ Once deployed, your Railway URL never changes
✅ You can keep using it after tomorrow's test
✅ OwnTracks configuration remains valid

### Data Persistence
⚠️ **Current setup stores data in memory**
- Data resets if Railway restarts the app
- For permanent storage, you'll need a database (future enhancement)
- For tomorrow's test, this is fine

### Backup Plan
If Railway has issues:
1. Run server locally: `npm start`
2. Use local IP: `http://[your-ip]:3000/owntracks`
3. Requires phone and laptop on same WiFi

## 🎯 Success Criteria

Tomorrow's test is successful if:
- ✅ OwnTracks sends location data
- ✅ Bus position appears on map in real-time
- ✅ Route visualization works
- ✅ Map updates smoothly during the journey
- ✅ You can access it from any device via the URL

## 📞 Quick Reference

**Your Railway URLs** (fill in after deployment):
- Public Map: `____________________________`
- Admin Panel: `____________________________`
- OwnTracks URL: `____________________________`

**Admin Credentials** (what you set in Railway):
- Username: `____________________________`
- Password: `____________________________`

**OwnTracks Device ID**:
- TID: `____________________________`

---

Good luck with tomorrow's test! 🚌📍

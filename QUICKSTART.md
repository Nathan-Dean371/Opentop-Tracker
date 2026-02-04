# Quick Start Guide

## Running the Application

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

3. **Access the application:**
   - Dashboard: http://localhost:3000
   - Admin Panel: http://localhost:3000/admin  ⭐ **NEW**
   - Embeddable map: http://localhost:3000/embed

## New Features Overview

The tracker now includes:
- 🛣️ Route management with visual builder
- 🛑 Stop management with map picker
- 🚌 Bus registration and tracker assignment
- 🔄 Bus-to-route assignments
- ⏱️ Real-time ETA calculations
- 🎨 Comprehensive admin panel

## Quick Setup (5 minutes)

### 1. Create a Route (Admin Panel)

1. Go to http://localhost:3000/admin
2. Click the **Routes** tab
3. Click on the map to add waypoints (the route will automatically follow roads between them!)
4. Enter a name: "City Tour"
5. Choose a color
6. Click **Add Route (Road-Following)**

### 2. Add Stops (Admin Panel)

1. Click the **Stops** tab
2. Select your route from the dropdown
3. Click **Pick from Map** and click on the stop location
4. Enter stop name: "City Hall"
5. Set order: 1
6. Click **Add Stop**
7. Repeat for more stops (order: 2, 3, 4...)

### 3. Register a Bus (Admin Panel)

1. Click the **Buses** tab
2. Enter name: "Red Bus"
3. Enter number: "101"
4. Enter tracker ID: "AB" (from OwnTracks)
5. Click **Add Bus**

### 4. Assign Bus to Route (Admin Panel)

1. Click the **Assignments** tab
2. Select "Red Bus" from dropdown
3. Select "City Tour" from dropdown
4. Click **Assign Bus to Route**

### 5. Configure OwnTracks

1. Open OwnTracks app on your phone
2. Set Mode: **HTTP**
3. Set URL: `http://YOUR-SERVER-IP:3000/owntracks`
4. Set Device ID (TID): **AB** (must match step 3)
5. Enable location tracking

Done! View live tracking at http://localhost:3000

## Sending Test Data

You can test the application without OwnTracks by sending sample data:

```bash
# Run the included test suite
python3 test.py
```

Or manually send data using curl:

```bash
curl -X POST http://localhost:3000/owntracks \
  -H "Content-Type: application/json" \
  -d '{
    "_type": "location",
    "lat": 51.505,
    "lon": -0.09,
    "tst": 1706381176,
    "tid": "bus1",
    "batt": 85,
    "acc": 10,
    "vel": 15,
    "alt": 50
  }'
```

## Configuring OwnTracks

### iOS/Android App

1. Download OwnTracks from App Store or Google Play
2. Open Settings → Connection
3. Set Mode to **HTTP**
4. Set URL to `http://YOUR_SERVER_IP:3000/owntracks`
5. Set Device ID (e.g., "bus1", "bus2")
6. Enable location tracking

### Testing with Different Devices

You can track multiple buses by using different Device IDs (tid) in OwnTracks settings. Each device will appear as a separate marker on the map.

## Customizing Routes

Edit the `/api/routes` endpoint in `server.js`:

```javascript
const routes = [
  {
    id: 'route1',
    name: 'City Center Tour',
    coordinates: [
      [51.505, -0.09],  // Start point
      [51.51, -0.1],    // Waypoint
      [51.51, -0.12],   // Waypoint
      [51.505, -0.13],  // Waypoint
      [51.505, -0.09]   // End point (closes the route)
    ]
  },
  {
    id: 'route2',
    name: 'Harbor Tour',
    coordinates: [
      // Add your route coordinates here
    ]
  }
];
```

Coordinates are in [latitude, longitude] format.

## Embedding on Your Website

Add this iframe to any webpage:

```html
<iframe 
  src="http://your-server-ip:3000/embed" 
  width="100%" 
  height="600px" 
  frameborder="0"
  style="border: 0; border-radius: 8px;">
</iframe>
```

## Troubleshooting

**Map not showing?**
- Check browser console for errors
- Ensure internet connection is available (for loading map tiles)

**Bus not appearing?**
- Verify OwnTracks is sending data (check server console logs)
- Test with the included test.py script
- Check that the URL in OwnTracks is correct

**Multiple buses not showing?**
- Ensure each device has a unique tid (Device ID)
- Check /api/locations endpoint to see tracked buses

## API Reference

### POST /owntracks
Receives OwnTracks location data.

### GET /api/locations
Returns all current bus locations as JSON.

### GET /api/routes  
Returns defined bus routes as JSON.

### GET /
Main dashboard with full interface.

### GET /embed
Minimal embeddable map interface.

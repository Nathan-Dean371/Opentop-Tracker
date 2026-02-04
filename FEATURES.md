# OpenTop Tracker - New Features Guide

## Overview

The OpenTop Tracker has been enhanced with comprehensive route management, stop tracking, bus assignments, and ETA calculations. This guide will help you get started with these new features.

## Getting Started

### 1. Start the Server

```bash
npm start
```

The server will start on port 3000 with the following endpoints:
- **Main Dashboard**: http://localhost:3000
- **Admin Panel**: http://localhost:3000/admin
- **Embed View**: http://localhost:3000/embed

### 2. Access the Admin Panel

Open http://localhost:3000/admin in your browser. This is your control center for managing all aspects of the tracking system.

## Step-by-Step Setup

### Step 1: Create a Route

1. Go to the **Routes** tab in the admin panel
2. Click on the map to add waypoints for your bus route
3. Each click adds a point - the route will **automatically follow roads** between points using OSRM routing
4. Enter a descriptive name (e.g., "Downtown Loop")
5. Choose a color for the route line
6. Click **Add Route (Road-Following)**

**Tips**:
- Add at least 2 waypoints to create a route
- The route automatically follows actual roads between your waypoints
- You don't need to click every turn - just major waypoints
- Click **Clear Points** to start over
- Routes will appear as colored lines following roads on the map
- Uses OSRM (Open Source Routing Machine) for routing

### Step 2: Add Stops

1. Go to the **Stops** tab
2. Select the route you just created
3. Enter a stop name (e.g., "City Hall", "Museum")
4. Click **Pick from Map** and click on the map where the stop is located
   - OR manually enter latitude/longitude
5. Set the stop order (1, 2, 3, etc.) to define the sequence
6. Click **Add Stop**
7. Repeat for all stops along your route

**Tips**:
- Stop order determines the sequence along the route
- Use sequential numbers: 0, 1, 2, 3...
- Stops appear as green markers with "S" on the map

### Step 3: Register Buses

1. Go to the **Buses** tab
2. Enter a bus name (e.g., "Red Bus", "Tour Bus Alpha")
3. Enter a bus number (e.g., "101", "A1")
4. Enter the OwnTracks Tracker ID (TID):
   - This is the device ID from your OwnTracks app
   - Usually 2 characters (e.g., "AB", "01", "X2")
   - Find it in OwnTracks app settings
5. Click **Add Bus**

**Tips**:
- The Tracker ID links the physical GPS tracker to this bus
- You can add a bus without a tracker ID and assign it later
- Each bus should have a unique tracker ID

### Step 4: Assign Buses to Routes

1. Go to the **Assignments** tab
2. Select a bus from the dropdown
3. Select a route from the dropdown
4. Click **Assign Bus to Route**
5. The assignment table will update to show the connection

**Tips**:
- A bus can only be assigned to one route at a time
- You can reassign buses to different routes anytime
- Assignments are required for ETA calculations

### Step 5: Configure OwnTracks

On your mobile device with OwnTracks:

1. Open the OwnTracks app
2. Go to Settings/Preferences
3. Set **Mode** to "HTTP"
4. Set **URL** to: `http://your-server-ip:3000/owntracks`
   - Replace `your-server-ip` with your actual server IP
   - Example: `http://192.168.1.100:3000/owntracks`
5. Set **Device ID** (TID) to match the tracker ID you entered in Step 3
6. Enable location services
7. The app will start sending location data automatically

**Tips**:
- Make sure your server is accessible from your phone's network
- Test with the local network before deploying to the internet
- Check the server console for incoming location updates

### Step 6: View Live Tracking

1. Go to the main dashboard at http://localhost:3000
2. You should see:
   - Your routes as colored lines
   - Stops as green markers
   - Buses as red markers (once location data arrives)
   - Bus info cards showing:
     - Battery level
     - Speed
     - Next stop
     - ETA to next stop

## Understanding ETA

The ETA (Estimated Time of Arrival) feature shows how long until a bus reaches its next stop:

**Requirements for ETA**:
- ✅ Bus must be registered
- ✅ Tracker must be assigned to the bus
- ✅ Bus must be assigned to a route
- ✅ Route must have stops defined
- ✅ OwnTracks must be sending location data
- ✅ Bus must be moving (velocity > 0)

**How it works**:
1. System gets current bus location from OwnTracks
2. Calculates distance to all stops on the assigned route
3. Identifies the closest stop as "next stop"
4. Uses current speed: `ETA = distance / speed`
5. Displays result in minutes and seconds

**Example**:
- Distance to next stop: 500 meters
- Current speed: 10 m/s (36 km/h)
- ETA: 500 / 10 = 50 seconds

## Embedding on Your Website

To display the map on your website:

```html
<iframe 
  src="http://your-server-url:3000/embed" 
  width="100%" 
  height="600" 
  frameborder="0"
  style="border: 0;">
</iframe>
```

The embedded view shows:
- All active routes
- All stops
- Live bus positions
- ETAs in bus popups
- Auto-updates every 5 seconds

## API Usage Examples

### Get All Routes
```bash
curl http://localhost:3000/api/routes
```

### Create a Route
```bash
curl -X POST http://localhost:3000/api/routes \
  -H "Content-Type: application/json" \
  -d '{
    "name": "City Tour",
    "coordinates": [[51.505, -0.09], [51.51, -0.1]],
    "color": "#FF5722"
  }'
```

### Get ETA for a Tracker
```bash
curl http://localhost:3000/api/eta/AB
```

## Troubleshooting

### No bus location showing
- ✅ Check OwnTracks is sending data (look for console logs)
- ✅ Verify the tracker ID matches in both OwnTracks and the admin panel
- ✅ Ensure your phone has location permissions enabled
- ✅ Check the URL in OwnTracks is correct

### ETA shows "Calculating..."
- ✅ Make sure the bus is assigned to a route
- ✅ Verify the route has stops defined
- ✅ Check that OwnTracks is sending velocity data
- ✅ Ensure the bus is moving (speed > 0)

### Routes not visible
- ✅ Make sure you added at least 2 points to the route
- ✅ Check that the route was saved successfully
- ✅ Try refreshing the page

### Stops not appearing
- ✅ Verify the stop has valid coordinates
- ✅ Check that the stop is assigned to a route
- ✅ Zoom out on the map to see if stops are outside current view

## Data Persistence Warning

⚠️ **Important**: All data (routes, stops, buses, assignments) is stored in memory.

When you restart the server, all configuration will be lost!

**For production use**:
- Implement database storage (MongoDB, PostgreSQL, SQLite)
- Export/import configuration as JSON
- Use environment variables for initial setup

## Next Steps

- ✅ Create your routes and stops
- ✅ Register your buses
- ✅ Make assignments
- ✅ Configure OwnTracks devices
- ✅ Test the system
- ✅ Embed on your website
- 🔒 Add authentication for production
- 💾 Implement database for persistence
- 🌐 Deploy to a cloud platform

## Support

For issues or questions:
- Check the main README.md for detailed documentation
- Review the API endpoints documentation
- Test each component separately
- Check browser console for errors
- Verify server console logs

## Feature Summary

| Feature | Description | Status |
|---------|-------------|--------|
| Route Management | Create, edit, delete routes with custom colors | ✅ Complete |
| Stop Management | Add stops with coordinates and ordering | ✅ Complete |
| Bus Registration | Register buses with names and tracker IDs | ✅ Complete |
| Bus-Route Assignment | Assign buses to specific routes | ✅ Complete |
| Tracker Assignment | Link OwnTracks devices to buses | ✅ Complete |
| ETA Calculation | Real-time ETA to next stop | ✅ Complete |
| Embeddable Map | Full-featured map for websites | ✅ Complete |
| Admin Panel | GUI for easy management | ✅ Complete |
| Live Tracking | Real-time bus positions | ✅ Complete |

Enjoy your enhanced bus tracking system! 🚌📍

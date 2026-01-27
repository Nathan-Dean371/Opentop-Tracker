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
   - Embeddable map: http://localhost:3000/embed

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

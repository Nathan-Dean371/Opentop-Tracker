# Road-Following Routes Feature

## Overview

Routes now automatically follow actual roads instead of drawing straight lines between points. This provides realistic bus route visualization that matches how buses actually travel through cities.

## How It Works

### Technology
- **OSRM (Open Source Routing Machine)**: Free, open-source routing service
- **API Endpoint**: `https://router.project-osrm.org/route/v1/driving/`
- **Method**: Converts waypoints into road-following coordinates

### Process

1. **User adds waypoints** by clicking on the map in the admin panel
2. **JavaScript calls OSRM API** with the waypoints
3. **OSRM returns road-following coordinates** (hundreds of points)
4. **Route is saved** with both road-following coordinates and original waypoints
5. **Map displays** the road-following route

### Example

**Input (Waypoints):**
```javascript
[
  [51.505, -0.09],   // Start point
  [51.51, -0.1],     // Intermediate waypoint
  [51.515, -0.12]    // End point
]
```

**Output (Road-following coordinates):**
```javascript
[
  [51.505, -0.09],
  [51.5052, -0.0903],
  [51.5055, -0.0907],
  // ... hundreds of points following the actual road
  [51.515, -0.12]
]
```

## Using the Feature

### In Admin Panel

1. Go to **Routes** tab
2. Click on map to add waypoints (major points only):
   - Start of route
   - Major intersections
   - Turns
   - End of route
3. Watch the preview update to follow roads
4. Click **Add Route (Road-Following)**

### What Gets Saved

```json
{
  "id": "route-1706381176123",
  "name": "City Tour",
  "coordinates": [[51.505, -0.09], ...hundreds of points...],  // Road-following path
  "waypoints": [[51.505, -0.09], [51.51, -0.1]],              // Original waypoints
  "color": "#FF5722"
}
```

## Benefits

✅ **Realistic Routes**: Shows actual driving paths  
✅ **Fewer Clicks**: Only need to mark major waypoints  
✅ **Accurate Distance**: True road distance, not straight-line  
✅ **Better ETA**: More accurate calculations  
✅ **Professional Look**: Routes look like real navigation  

## Technical Details

### OSRM API Call

```javascript
// Build URL with waypoints
const coords = waypoints.map(wp => `${wp[1]},${wp[0]}`).join(';');
const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

// Fetch routing data
const response = await fetch(url);
const data = await response.json();

// Extract road-following coordinates
const roadCoords = data.routes[0].geometry.coordinates.map(
  coord => [coord[1], coord[0]]  // Convert [lon, lat] to [lat, lon]
);
```

### Fallback Behavior

If OSRM is unavailable or fails:
- Routes fall back to straight lines between waypoints
- Warning logged to console
- Route still gets created
- System continues to function

### Performance

- **API Call**: ~200-500ms per route
- **Data Size**: Routes with 3 waypoints → ~100-300 coordinate points
- **Caching**: Recommended for production (save routed coordinates)
- **Rate Limit**: OSRM public API has fair use limits

## Limitations

### Current Limitations

1. **Editing Routes**: Currently need to delete and recreate
2. **Route Type**: Only driving routes (no walking/cycling options yet)
3. **Public API**: Using free OSRM service (has rate limits)
4. **No Traffic**: Route doesn't consider current traffic
5. **Static**: Route is calculated once at creation

### Future Enhancements

- [ ] Self-hosted OSRM server for better performance
- [ ] Route editing (modify waypoints)
- [ ] Multiple transport modes (driving, walking, cycling)
- [ ] Traffic-aware routing
- [ ] Alternative route suggestions
- [ ] Route optimization
- [ ] Custom routing preferences (avoid highways, prefer scenic, etc.)

## Production Considerations

### Self-Hosted OSRM

For production, consider hosting your own OSRM instance:

```bash
# Docker setup
docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/map.osm.pbf

docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-partition /data/map.osrm

docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-customize /data/map.osrm

docker run -t -i -p 5000:5000 -v "${PWD}:/data" \
  ghcr.io/project-osrm/osrm-backend osrm-routed --algorithm mld /data/map.osrm
```

Then update the API URL in admin.html:
```javascript
const url = `http://your-osrm-server:5000/route/v1/driving/${coords}?overview=full&geometries=geojson`;
```

### Caching Strategy

```javascript
// Cache routed coordinates to avoid repeated API calls
const routeCache = new Map();

async function getRoutingCoordinates(waypoints) {
  const cacheKey = JSON.stringify(waypoints);
  
  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey);
  }
  
  const coordinates = await fetchFromOSRM(waypoints);
  routeCache.set(cacheKey, coordinates);
  
  return coordinates;
}
```

### Alternative Services

Instead of OSRM, you can use:

1. **Mapbox Directions API**: `https://api.mapbox.com/directions/v5/`
   - Requires API key
   - Generous free tier
   - Very fast

2. **GraphHopper API**: `https://graphhopper.com/api/1/route`
   - Open source option
   - Self-hostable
   - Good documentation

3. **Google Maps Directions API**: `https://maps.googleapis.com/maps/api/directions/`
   - Requires API key and billing
   - Most accurate
   - Expensive

## Testing

### Test Road Following

1. Open admin panel: http://localhost:3000/admin
2. Go to Routes tab
3. Click two points far apart (e.g., different neighborhoods)
4. Watch the route snap to roads in the preview
5. Save the route
6. View on main dashboard - route follows streets

### Verify Fallback

1. Disconnect from internet (or use browser dev tools to block OSRM domain)
2. Try creating a route
3. Should create straight-line route with console warning
4. Route still functions normally

## Troubleshooting

### Route doesn't follow roads
- **Check**: Browser console for OSRM errors
- **Fix**: Ensure internet connection is active
- **Verify**: OSRM service is accessible at https://router.project-osrm.org

### Route creation is slow
- **Cause**: OSRM API call takes time for complex routes
- **Solution**: Be patient, typically 200-500ms
- **Alternative**: Self-host OSRM for faster responses

### Route has weird paths
- **Cause**: OSRM might route through one-way streets or use optimal path
- **Solution**: Add more waypoints to guide the route
- **Tip**: Add waypoints at major intersections you want to pass through

### Fallback to straight lines
- **Check**: Browser console shows "OSRM routing failed"
- **Reasons**: 
  - No internet connection
  - OSRM service down
  - Waypoints in unreachable locations (e.g., ocean)
- **Solution**: Check waypoint locations are on roads

## API Reference

### OSRM Route API

**Endpoint**: `https://router.project-osrm.org/route/v1/{profile}/{coordinates}`

**Parameters**:
- `profile`: driving, walking, cycling
- `coordinates`: lon,lat;lon,lat;... (semicolon separated)
- `overview`: full, simplified, false
- `geometries`: geojson, polyline, polyline6

**Example Request**:
```
GET https://router.project-osrm.org/route/v1/driving/-0.09,51.505;-0.1,51.51?overview=full&geometries=geojson
```

**Example Response**:
```json
{
  "code": "Ok",
  "routes": [{
    "geometry": {
      "coordinates": [
        [-0.09, 51.505],
        [-0.091, 51.506],
        ...
      ],
      "type": "LineString"
    },
    "distance": 1250.5,
    "duration": 180.2
  }],
  "waypoints": [...]
}
```

## Summary

The road-following feature makes your bus routes look professional and realistic. Routes automatically snap to actual streets, making it easy to create accurate route visualizations with just a few clicks.

**Key Points**:
- ✅ Click waypoints, get road-following routes automatically
- ✅ Uses free OSRM service
- ✅ Falls back to straight lines if routing fails
- ✅ Saves both waypoints and road-following coordinates
- ✅ Works out of the box, no configuration needed
- 🔄 Consider self-hosting OSRM for production

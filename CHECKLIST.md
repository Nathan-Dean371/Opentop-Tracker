# OpenTop Tracker - Setup Checklist

Use this checklist to ensure your bus tracking system is properly configured.

## Initial Setup

- [ ] Clone the repository
- [ ] Run `npm install`
- [ ] Run `npm start`
- [ ] Verify server starts on port 3000
- [ ] Access http://localhost:3000 (main dashboard)
- [ ] Access http://localhost:3000/admin (admin panel)
- [ ] Access http://localhost:3000/embed (embed view)

## Route Configuration

- [ ] Open admin panel at http://localhost:3000/admin
- [ ] Navigate to **Routes** tab
- [ ] Click on map to create route points (minimum 2)
- [ ] Enter a descriptive route name
- [ ] Select a color for the route
- [ ] Click **Add Route**
- [ ] Verify route appears in the table below
- [ ] Verify route displays on the map preview
- [ ] Return to main dashboard and confirm route is visible

**Repeat for each route you need**

## Stop Configuration

For each route:
- [ ] Navigate to **Stops** tab in admin panel
- [ ] Select the route from dropdown
- [ ] Enter stop name (e.g., "City Hall")
- [ ] Click **Pick from Map** OR enter coordinates manually
- [ ] Set stop order (0, 1, 2, 3...)
- [ ] Click **Add Stop**
- [ ] Verify stop appears in table
- [ ] Return to main dashboard and confirm stop marker is visible

**Tip**: Number stops sequentially (0, 1, 2, 3...) in the order buses visit them

## Bus Registration

For each bus:
- [ ] Navigate to **Buses** tab in admin panel
- [ ] Enter bus name (e.g., "Red Double Decker")
- [ ] Enter bus number (e.g., "101")
- [ ] Enter OwnTracks tracker ID (e.g., "AB")
  - [ ] Note: This must match the TID in your OwnTracks app
- [ ] Click **Add Bus**
- [ ] Verify bus appears in table

## Bus-Route Assignment

For each bus:
- [ ] Navigate to **Assignments** tab in admin panel
- [ ] Select bus from dropdown
- [ ] Select route from dropdown
- [ ] Click **Assign Bus to Route**
- [ ] Verify assignment appears in table

## OwnTracks Configuration

For each tracker device:
- [ ] Install OwnTracks app on mobile device
- [ ] Open OwnTracks settings
- [ ] Set connection mode to **HTTP**
- [ ] Set URL to: `http://YOUR-SERVER-IP:3000/owntracks`
  - [ ] Replace YOUR-SERVER-IP with actual server address
  - [ ] Example: `http://192.168.1.100:3000/owntracks`
- [ ] Set Device ID (TID) to match the tracker ID in admin panel
  - [ ] Example: "AB", "CD", "01", "02"
- [ ] Enable location services on device
- [ ] Grant location permissions to OwnTracks app
- [ ] Start tracking in OwnTracks app

## Testing

### Test Route Display
- [ ] Open main dashboard
- [ ] Verify all routes are visible as colored lines
- [ ] Click on a route and verify popup shows route name
- [ ] Verify route colors match what you configured

### Test Stop Display
- [ ] Verify all stops are visible as green "S" markers
- [ ] Click on a stop and verify popup shows stop info
- [ ] Verify stops are on the correct routes

### Test Location Tracking
- [ ] Send test data from OwnTracks (or use test.py)
- [ ] Refresh the main dashboard
- [ ] Verify bus marker appears on map
- [ ] Click bus marker and verify popup shows:
  - [ ] Bus name and number
  - [ ] Status (Active/Inactive)
  - [ ] Battery level
  - [ ] Speed
  - [ ] Last update time
- [ ] Wait for location update and verify marker moves
- [ ] Verify info card appears below map

### Test ETA Calculation
Prerequisites:
- [ ] Bus is registered
- [ ] Tracker ID is assigned to bus
- [ ] Bus is assigned to route
- [ ] Route has stops defined
- [ ] OwnTracks is sending location data with velocity

Test steps:
- [ ] Open main dashboard
- [ ] Click on bus marker
- [ ] Verify popup shows "Next Stop" section
- [ ] Verify next stop name is displayed
- [ ] Verify distance to stop is shown
- [ ] Verify ETA is calculated (requires movement)
- [ ] Move the bus and verify ETA updates
- [ ] Check info card shows ETA information

### Test Embed View
- [ ] Open http://localhost:3000/embed
- [ ] Verify map displays in full screen
- [ ] Verify routes are visible
- [ ] Verify stops are visible
- [ ] Verify bus markers are visible
- [ ] Click bus marker and verify popup shows ETA
- [ ] Test embedding in HTML:
  ```html
  <iframe src="http://localhost:3000/embed" width="800" height="600"></iframe>
  ```
- [ ] Verify iframe displays correctly

### Test Admin Panel Functions

#### Routes
- [ ] Create a new route
- [ ] Edit route name (currently manual - delete and recreate)
- [ ] Delete a route
- [ ] Verify changes appear on main dashboard

#### Stops
- [ ] Create a new stop
- [ ] Edit stop details (currently manual - delete and recreate)
- [ ] Delete a stop
- [ ] Verify changes appear on main dashboard

#### Buses
- [ ] Create a new bus
- [ ] Edit bus details (currently manual - delete and recreate)
- [ ] Delete a bus
- [ ] Verify changes appear on main dashboard

#### Assignments
- [ ] Assign bus to different route
- [ ] Reassign bus to another route
- [ ] Verify assignment changes in table

## API Testing

### Test Location Endpoint
```bash
curl http://localhost:3000/api/locations
```
- [ ] Returns JSON with bus locations

### Test Routes Endpoint
```bash
curl http://localhost:3000/api/routes
```
- [ ] Returns array of routes

### Test Stops Endpoint
```bash
curl http://localhost:3000/api/stops
```
- [ ] Returns array of stops

### Test Buses Endpoint
```bash
curl http://localhost:3000/api/buses
```
- [ ] Returns array of buses

### Test ETA Endpoint
```bash
curl http://localhost:3000/api/eta/AB
```
- [ ] Returns ETA data for tracker "AB"

### Send Test Location Data
```bash
curl -X POST http://localhost:3000/owntracks \
  -H "Content-Type: application/json" \
  -d '{
    "_type": "location",
    "lat": 51.505,
    "lon": -0.09,
    "tst": 1706381176,
    "tid": "AB",
    "batt": 85,
    "acc": 10,
    "vel": 15,
    "alt": 50
  }'
```
- [ ] Returns success response
- [ ] Location appears on dashboard

## Production Readiness

⚠️ **Do NOT deploy to production without completing these:**

### Security
- [ ] Implement authentication for admin panel
- [ ] Add API authentication (JWT/API keys)
- [ ] Enable HTTPS/TLS
- [ ] Add rate limiting
- [ ] Validate all user inputs
- [ ] Sanitize data before storing
- [ ] Add CSRF protection
- [ ] Secure the /owntracks endpoint

### Data Persistence
- [ ] Choose database (MongoDB/PostgreSQL/SQLite)
- [ ] Implement data models/schemas
- [ ] Add database connection handling
- [ ] Migrate in-memory storage to database
- [ ] Implement data backup strategy
- [ ] Add database indexing for performance

### Monitoring
- [ ] Set up logging (Winston/Bunyan)
- [ ] Add error tracking (Sentry)
- [ ] Implement health check endpoint
- [ ] Add performance monitoring
- [ ] Set up alerts for issues
- [ ] Monitor resource usage

### Performance
- [ ] Implement caching (Redis)
- [ ] Add database connection pooling
- [ ] Optimize API responses
- [ ] Add CDN for static files
- [ ] Consider WebSocket for real-time updates
- [ ] Load test the application

### Deployment
- [ ] Set up environment variables
- [ ] Configure production server (PM2/Forever)
- [ ] Set up reverse proxy (Nginx/Apache)
- [ ] Configure SSL certificates
- [ ] Set up domain name
- [ ] Configure firewall rules
- [ ] Plan for scaling (load balancer)

## Documentation
- [ ] Read README.md for full documentation
- [ ] Review FEATURES.md for detailed guide
- [ ] Check ARCHITECTURE.md for system design
- [ ] Review IMPLEMENTATION.md for technical details
- [ ] Keep QUICKSTART.md handy for reference

## Troubleshooting Reference

| Issue | Check | Solution |
|-------|-------|----------|
| Server won't start | Port in use | Change PORT or stop other service |
| Bus not showing | Tracker ID mismatch | Verify TID matches in OwnTracks and admin |
| No ETA calculated | Missing assignment | Complete all assignment steps |
| Routes not visible | Too few points | Add at least 2 points to route |
| Stops not showing | Wrong coordinates | Verify lat/lon values |
| Data lost after restart | In-memory storage | Implement database persistence |

## Success Criteria

Your system is ready when:
- ✅ All routes are visible on the map
- ✅ All stops are marked and properly ordered
- ✅ All buses are registered with tracker IDs
- ✅ All buses are assigned to routes
- ✅ OwnTracks is sending location data
- ✅ Bus markers appear and update in real-time
- ✅ ETA calculations are working
- ✅ Embed view works independently
- ✅ Admin panel operates smoothly

## Support

If you encounter issues:
1. Check server console for errors
2. Check browser console for errors
3. Verify all prerequisites are met
4. Review the documentation files
5. Test individual components separately
6. Check OwnTracks app logs

---

**Last Updated**: February 3, 2026  
**For**: OpenTop Tracker v1.0

const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Admin credentials from environment variables (with defaults for local dev)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'opentop123';

// Simple Basic Auth middleware for admin panel
function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
    return res.status(401).send('Authentication required');
  }
  
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');
  
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
    res.status(401).send('Invalid credentials');
  }
}

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increased limit for large route coordinates
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));
// Serve Leaflet from node_modules
app.use('/leaflet', express.static(path.join(__dirname, 'node_modules/leaflet/dist')));

// Data file path - use Railway volume if available, otherwise current directory
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

console.log(`📁 Data will be stored at: ${DATA_FILE}`);

// Storage: bus locations are in-memory (real-time), everything else persists
let busLocations = {};
let routes = [];
let stops = [];
let buses = [];
let busAssignments = {}; // Maps tracker ID to bus ID
let busRouteAssignments = {}; // Maps bus ID to route ID
let manualNextStops = {}; // Maps bus ID to manually set next stop ID
let busNextStopState = {}; // Maps bus ID to next-stop progression state

// Fixed daily departure times (first-stop departures) in local time
// Used to determine "next run" when the bus is waiting at the start.
const FIXED_DEPARTURE_TIMES_MINUTES = [
  parseTimeToMinutes('09:30'),
  parseTimeToMinutes('11:00'),
  parseTimeToMinutes('12:30'),
  parseTimeToMinutes('14:00'),
  parseTimeToMinutes('15:30')
].filter(v => v !== null).sort((a, b) => a - b);

const START_WAIT_RADIUS_METERS = 60; // how close to first stop counts as "at start"
const STOPPED_SPEED_KMH_THRESHOLD = 2; // below this is treated as stopped
const ARRIVAL_RADIUS_METERS = 50; // distance within which we consider a stop "reached"
const MOVING_AWAY_DELTA_METERS = 25; // minimum distance increase to treat as moving away
const MOVING_AWAY_MIN_CONSECUTIVE = 2; // consecutive checks before auto-advancing a stale stop

// Load persisted data on startup
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      routes = data.routes || [];
      stops = data.stops || [];
      buses = data.buses || [];
      busAssignments = data.busAssignments || {};
      busRouteAssignments = data.busRouteAssignments || {};
      manualNextStops = data.manualNextStops || {};
      // Migrate any existing operatingHours to canonical 'HH:MM' format
      try {
        let migrated = false;
        buses.forEach(b => {
          if (b && b.operatingHours) {
            const s = normalizeTimeFormat(b.operatingHours.start);
            const e = normalizeTimeFormat(b.operatingHours.end);
            if (s && e) {
              if (b.operatingHours.start !== s || b.operatingHours.end !== e) {
                b.operatingHours = { start: s, end: e };
                migrated = true;
              }
            } else {
              // Invalid or unparseable hours — clear to null
              if (b.operatingHours !== null) {
                b.operatingHours = null;
                migrated = true;
              }
            }
          }
        });

        if (migrated) {
          dataChanged = true;
          saveData();
          console.log('🔧 Migrated operatingHours to canonical HH:MM format');
        }
      } catch (e) {
        console.error('⚠️ Error migrating operatingHours:', e && e.message);
      }
      console.log('✅ Loaded persisted data:', {
        routes: routes.length,
        stops: stops.length,
        buses: buses.length
      });
    }
  } catch (error) {
    console.error('⚠️ Error loading data:', error.message);
  }
}

// Save data to disk
function saveData() {
  try {
    const data = {
      routes,
      stops,
      buses,
      busAssignments,
      busRouteAssignments,
      manualNextStops,
      savedAt: new Date().toISOString()
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log('💾 Data saved to disk');
  } catch (error) {
    console.error('⚠️ Error saving data:', error.message);
  }
}

// Auto-save every 30 seconds if data changed
let dataChanged = false;
setInterval(() => {
  if (dataChanged) {
    saveData();
    dataChanged = false;
  }
}, 30000);

// Load data on startup
loadData();

// OwnTracks webhook endpoint
app.post('/owntracks', (req, res) => {
  const data = req.body;
  
  // OwnTracks sends location data in this format
  if (data._type === 'location') {
    const deviceId = data.tid || 'default';
    
    busLocations[deviceId] = {
      lat: data.lat,
      lon: data.lon,
      timestamp: data.tst || Math.floor(Date.now() / 1000),
      battery: data.batt,
      accuracy: data.acc,
      velocity: data.vel,
      altitude: data.alt
    };
    
    console.log(`Location update for device ${deviceId}:`, busLocations[deviceId]);
  }
  
  res.status(200).json({ success: true });
});

// Get current bus locations
app.get('/api/locations', (req, res) => {
  // Only return trackers that are currently within their bus operating hours
  const now = new Date();
  const visibleLocations = {};

  Object.keys(busLocations).forEach(trackerId => {
    const location = busLocations[trackerId];
    const busId = busAssignments[trackerId];

    // Only show trackers that are assigned to a bus AND that bus
    // is assigned to a route. This ensures a tracker that is merely
    // sending data never causes a bus to appear on the public view
    // page unless the full configuration is in place.
    if (!busId) {
      return;
    }

    const bus = buses.find(b => b.id === busId);
    if (!bus) {
      return;
    }

    const routeId = busRouteAssignments[busId];
    if (!routeId) {
      return;
    }

    if (bus.operatingHours && !isWithinOperatingHours(bus.operatingHours, now)) {
      // Skip this tracker — outside operating hours
      return;
    }

    visibleLocations[trackerId] = location;
  });

  res.json(visibleLocations);
});

// Sample route data endpoint
app.get('/api/routes', (req, res) => {
  res.json(routes);
});

// Add a new route
app.post('/api/routes', basicAuth, (req, res) => {
  const { name, coordinates, color, waypoints } = req.body;
  const route = {
    id: `route-${Date.now()}`,
    name,
    coordinates,
    waypoints: waypoints || coordinates,  // Store original waypoints for editing
    color: color || '#3388ff',
    visible: true, // Routes are visible by default
    createdAt: new Date().toISOString()
  };
  routes.push(route);
  dataChanged = true;
  res.status(201).json(route);
});

// Update a route
app.put('/api/routes/:id', basicAuth, (req, res) => {
  const { id } = req.params;
  const { name, coordinates, color } = req.body;
  const routeIndex = routes.findIndex(r => r.id === id);
  
  if (routeIndex === -1) {
    return res.status(404).json({ error: 'Route not found' });
  }
  
  routes[routeIndex] = {
    ...routes[routeIndex],
    name: name || routes[routeIndex].name,
    coordinates: coordinates || routes[routeIndex].coordinates,
    color: color || routes[routeIndex].color
  };
  
  dataChanged = true;
  res.json(routes[routeIndex]);
});

// Delete a route
app.delete('/api/routes/:id', basicAuth, (req, res) => {
  const { id } = req.params;
  const routeIndex = routes.findIndex(r => r.id === id);
  
  if (routeIndex === -1) {
    return res.status(404).json({ error: 'Route not found' });
  }
  
  routes.splice(routeIndex, 1);
  dataChanged = true;
  res.status(204).send();
});

// Toggle route visibility
app.post('/api/routes/:id/visibility', basicAuth, (req, res) => {
  const { id } = req.params;
  const { visible } = req.body;
  const routeIndex = routes.findIndex(r => r.id === id);
  
  if (routeIndex === -1) {
    return res.status(404).json({ error: 'Route not found' });
  }
  
  routes[routeIndex].visible = visible;
  dataChanged = true;
  res.json({ id, visible, message: 'Route visibility updated' });
});

// Get all stops
app.get('/api/stops', (req, res) => {
  res.json(stops);
});

// Add a new stop
app.post('/api/stops', basicAuth, (req, res) => {
  const { name, lat, lon, routeId, order } = req.body;
  const stop = {
    id: `stop-${Date.now()}`,
    name,
    lat,
    lon,
    routeId,
    order: order || 0,
    createdAt: new Date().toISOString()
  };
  stops.push(stop);
  dataChanged = true;
  res.status(201).json(stop);
});

// Update a stop
app.put('/api/stops/:id', basicAuth, (req, res) => {
  const { id } = req.params;
  const { name, lat, lon, routeId, order } = req.body;
  const stopIndex = stops.findIndex(s => s.id === id);
  
  if (stopIndex === -1) {
    return res.status(404).json({ error: 'Stop not found' });
  }
  
  stops[stopIndex] = {
    ...stops[stopIndex],
    name: name || stops[stopIndex].name,
    lat: lat !== undefined ? lat : stops[stopIndex].lat,
    lon: lon !== undefined ? lon : stops[stopIndex].lon,
    routeId: routeId || stops[stopIndex].routeId,
    order: order !== undefined ? order : stops[stopIndex].order
  };
  
  dataChanged = true;
  res.json(stops[stopIndex]);
});

// Delete a stop
app.delete('/api/stops/:id', basicAuth, (req, res) => {
  const { id } = req.params;
  const stopIndex = stops.findIndex(s => s.id === id);
  
  if (stopIndex === -1) {
    return res.status(404).json({ error: 'Stop not found' });
  }
  
  stops.splice(stopIndex, 1);
  dataChanged = true;
  res.status(204).send();
});

// Bulk add stops
app.post('/api/stops/bulk', basicAuth, (req, res) => {
  const { stops: stopsToAdd } = req.body;
  
  if (!Array.isArray(stopsToAdd) || stopsToAdd.length === 0) {
    return res.status(400).json({ error: 'Invalid stops data' });
  }
  
  const addedStops = [];
  stopsToAdd.forEach((stopData, index) => {
    const stop = {
      id: `stop-${Date.now()}-${index}`,
      name: stopData.name,
      lat: stopData.lat,
      lon: stopData.lon,
      routeId: stopData.routeId,
      order: stopData.order || 0,
      createdAt: new Date().toISOString()
    };
    stops.push(stop);
    addedStops.push(stop);
  });
  
  dataChanged = true;
  res.status(201).json({ count: addedStops.length, stops: addedStops });
});

// Create stops from route waypoints
app.post('/api/routes/:routeId/create-stops', basicAuth, (req, res) => {
  const { routeId } = req.params;
  const { stopNamePrefix } = req.body;
  
  const route = routes.find(r => r.id === routeId);
  if (!route) {
    return res.status(404).json({ error: 'Route not found' });
  }
  
  // Use waypoints if available, otherwise use coordinates
  const points = route.waypoints || route.coordinates;
  
  if (!points || points.length === 0) {
    return res.status(400).json({ error: 'Route has no waypoints' });
  }
  
  const createdStops = [];
  points.forEach((point, index) => {
    const stop = {
      id: `stop-${Date.now()}-${index}`,
      name: stopNamePrefix ? `${stopNamePrefix} ${index + 1}` : `Stop ${index + 1}`,
      lat: point[0],
      lon: point[1],
      routeId: routeId,
      order: index + 1,
      createdAt: new Date().toISOString()
    };
    stops.push(stop);
    createdStops.push(stop);
  });
  
  dataChanged = true;
  res.status(201).json({
    message: `Created ${createdStops.length} stops from route waypoints`,
    stops: createdStops
  });
});

// Get all buses
app.get('/api/buses', (req, res) => {
  res.json(buses);
});

// Add a new bus
app.post('/api/buses', basicAuth, (req, res) => {
  const { name, number, trackerId, operatingHours } = req.body;
  // Normalize operatingHours to canonical 'HH:MM' format when provided
  let storedOperatingHours = null;
  if (operatingHours && (operatingHours.start || operatingHours.end)) {
    const s = normalizeTimeFormat(operatingHours.start);
    const e = normalizeTimeFormat(operatingHours.end);
    if (s && e) {
      storedOperatingHours = { start: s, end: e };
    }
  }

  const bus = {
    id: `bus-${Date.now()}`,
    name,
    number,
    trackerId,
    operatingHours: storedOperatingHours, // { start: 'HH:MM', end: 'HH:MM' } or null
    createdAt: new Date().toISOString()
  };
  buses.push(bus);
  
  if (trackerId) {
    busAssignments[trackerId] = bus.id;
  }
  
  dataChanged = true;
  res.status(201).json(bus);
});

// Update a bus
app.put('/api/buses/:id', basicAuth, (req, res) => {
  const { id } = req.params;
  const { name, number, trackerId, operatingHours } = req.body;
  const busIndex = buses.findIndex(b => b.id === id);
  
  if (busIndex === -1) {
    return res.status(404).json({ error: 'Bus not found' });
  }
  
  // Remove old tracker assignment
  if (buses[busIndex].trackerId) {
    delete busAssignments[buses[busIndex].trackerId];
  }
  
  // Normalize operatingHours if provided (PUT with undefined means leave unchanged)
  let newOperatingHours = buses[busIndex].operatingHours;
  if (operatingHours !== undefined) {
    if (operatingHours && (operatingHours.start || operatingHours.end)) {
      const s = normalizeTimeFormat(operatingHours.start);
      const e = normalizeTimeFormat(operatingHours.end);
      newOperatingHours = s && e ? { start: s, end: e } : null;
    } else {
      newOperatingHours = null;
    }
  }

  buses[busIndex] = {
    ...buses[busIndex],
    name: name || buses[busIndex].name,
    number: number || buses[busIndex].number,
    trackerId: trackerId || buses[busIndex].trackerId,
    operatingHours: newOperatingHours
  };
  
  // Add new tracker assignment
  if (trackerId) {
    busAssignments[trackerId] = id;
  }
  
  dataChanged = true;
  res.json(buses[busIndex]);
});

// Delete a bus
app.delete('/api/buses/:id', basicAuth, (req, res) => {
  const { id } = req.params;
  const busIndex = buses.findIndex(b => b.id === id);
  
  if (busIndex === -1) {
    return res.status(404).json({ error: 'Bus not found' });
  }
  
  // Remove tracker assignment
  if (buses[busIndex].trackerId) {
    delete busAssignments[buses[busIndex].trackerId];
  }
  
  // Remove route assignment
  delete busRouteAssignments[id];
  delete manualNextStops[id];
  delete busNextStopState[id];
  
  buses.splice(busIndex, 1);
  dataChanged = true;
  res.status(204).send();
});

// List trackers (derived from live locations and saved assignments)
app.get('/api/trackers', (req, res) => {
  const trackerSet = new Set([
    ...Object.keys(busLocations),
    ...Object.keys(busAssignments)
  ]);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const trackers = [];

  trackerSet.forEach(trackerId => {
    const loc = busLocations[trackerId];
    const busId = busAssignments[trackerId] || null;
    const bus = busId ? buses.find(b => b.id === busId) : null;

    let status = 'inactive';
    let lastSeen = null;
    let ageSeconds = null;

    if (loc && loc.timestamp) {
      ageSeconds = nowSeconds - loc.timestamp;
      lastSeen = new Date(loc.timestamp * 1000).toISOString();
      if (ageSeconds < 300) {
        status = 'active';
      }
    }

    trackers.push({
      trackerId,
      status,
      lastSeen,
      ageSeconds,
      busId,
      busName: bus ? bus.name : null,
      busNumber: bus ? bus.number : null
    });
  });

  res.json(trackers);
});

// Assign bus to route
app.post('/api/buses/:busId/assign-route', basicAuth, (req, res) => {
  const { busId } = req.params;
  const { routeId } = req.body;
  
  const bus = buses.find(b => b.id === busId);
  if (!bus) {
    return res.status(404).json({ error: 'Bus not found' });
  }
  
  const route = routes.find(r => r.id === routeId);
  if (!route) {
    return res.status(404).json({ error: 'Route not found' });
  }
  
  busRouteAssignments[busId] = routeId;
  delete manualNextStops[busId];
  delete busNextStopState[busId];
  dataChanged = true;
  res.json({ busId, routeId, message: 'Bus assigned to route successfully' });
});

// Assign or clear a tracker->bus link from the trackers tab
app.post('/api/trackers/:trackerId/assign-bus', basicAuth, (req, res) => {
  const { trackerId } = req.params;
  const { busId } = req.body;
  const previouslyAssignedBusId = busAssignments[trackerId] || null;

  // Allow clearing the assignment entirely
  if (!busId) {
    // Clear mapping
    delete busAssignments[trackerId];
    if (previouslyAssignedBusId) {
      delete manualNextStops[previouslyAssignedBusId];
      delete busNextStopState[previouslyAssignedBusId];
    }
    // Clear trackerId from any buses that reference it
    buses.forEach(b => {
      if (b.trackerId === trackerId) {
        b.trackerId = null;
      }
    });
    dataChanged = true;
    return res.json({ trackerId, busId: null, message: 'Tracker unassigned from all buses' });
  }

  const bus = buses.find(b => b.id === busId);
  if (!bus) {
    return res.status(404).json({ error: 'Bus not found' });
  }

  // Clear this tracker from any other buses to keep a 1:1 mapping
  buses.forEach(b => {
    if (b.id !== busId && b.trackerId === trackerId) {
      b.trackerId = null;
    }
  });

  // Update primary mapping and bus record
  busAssignments[trackerId] = busId;
  bus.trackerId = trackerId;
  if (previouslyAssignedBusId && previouslyAssignedBusId !== busId) {
    delete manualNextStops[previouslyAssignedBusId];
    delete busNextStopState[previouslyAssignedBusId];
  }
  delete manualNextStops[busId];
  delete busNextStopState[busId];

  dataChanged = true;
  res.json({ trackerId, busId, message: 'Tracker assigned to bus successfully' });
});

// Set manual next stop for a bus (for testing)
app.post('/api/buses/:busId/set-next-stop', basicAuth, (req, res) => {
  const { busId } = req.params;
  const { stopId } = req.body;
  
  const bus = buses.find(b => b.id === busId);
  if (!bus) {
    return res.status(404).json({ error: 'Bus not found' });
  }
  
  const stop = stops.find(s => s.id === stopId);
  if (!stop) {
    return res.status(404).json({ error: 'Stop not found' });
  }
  
  manualNextStops[busId] = stopId;
  dataChanged = true;
  res.json({ busId, stopId, message: 'Manual next stop set successfully' });
});

// Clear manual next stop for a bus
app.post('/api/buses/:busId/clear-next-stop', basicAuth, (req, res) => {
  const { busId } = req.params;
  
  delete manualNextStops[busId];
  dataChanged = true;
  res.json({ busId, message: 'Manual next stop cleared' });
});

// Get bus assignments
app.get('/api/assignments', (req, res) => {
  res.json({
    busAssignments,
    busRouteAssignments
  });
});

// Calculate ETA to next stop or "next run" if waiting at the start
app.get('/api/eta/:trackerId', (req, res) => {
  const { trackerId } = req.params;

  const busId = busAssignments[trackerId];
  if (!busId) {
    return res.status(404).json({ error: 'Tracker not assigned to any bus' });
  }

  const routeId = busRouteAssignments[busId];
  if (!routeId) {
    return res.status(404).json({ error: 'Bus not assigned to any route' });
  }

  const busLocation = busLocations[trackerId];
  if (!busLocation) {
    return res.status(404).json({ error: 'No location data for this tracker' });
  }

  const routeStops = stops
    .filter(s => s.routeId === routeId)
    .sort((a, b) => a.order - b.order);

  if (routeStops.length === 0) {
    return res.status(404).json({ error: 'No stops defined for this route' });
  }

  // Determine current speed (km/h) and m/s once
  const speedKmh = busLocation.velocity || 0; // OwnTracks sends velocity in km/h
  const speedMs = speedKmh / 3.6;

  // Check for manual next stop override first
  let nextStop = null;
  let isManualOverride = false;

  if (manualNextStops[busId]) {
    const manual = routeStops.find(s => s.id === manualNextStops[busId]);
    const distanceToManual = manual ? calculateDistance(busLocation.lat, busLocation.lon, manual.lat, manual.lon) : Infinity;

    // Check if we have arrived at the manually set stop.
    if (manual && distanceToManual <= ARRIVAL_RADIUS_METERS && speedKmh < STOPPED_SPEED_KMH_THRESHOLD) {
      // We've arrived. Clear the manual override and let automatic progression take over.
      delete manualNextStops[busId];
      dataChanged = true; // Ensure the change is saved
      nextStop = null; // Allow automatic logic to run
      isManualOverride = false;
      console.log(`✅ Bus ${busId} arrived at manual stop ${manual.id}. Reverting to automatic progression.`);
    } else if (manual) {
      // Manual override is active and we have not arrived yet.
      nextStop = manual;
      isManualOverride = true;
      // Clear any automatic progression state while manual override is active.
      delete busNextStopState[busId]; // This ensures the next automatic step starts fresh.
    }
  }

  const firstStop = routeStops[0];

  // If no manual override, maintain a monotonic next-stop progression per bus.
  if (!nextStop) {
    let targetStop = null;
    let movingAwayCount = 0;
 
    // Get the last known next stop state for this bus.
    // Backward-compatible with previous string-only state format.
    const lastState = busNextStopState[busId];
    const lastNextStopId = typeof lastState === 'string' ? lastState : lastState && lastState.nextStopId;
    const lastDistanceToStop = typeof lastState === 'object' ? lastState.lastDistanceToStop : null;
    const lastMovingAwayCount = typeof lastState === 'object' ? (lastState.movingAwayCount || 0) : 0;
    const lastNextStop = routeStops.find(s => s.id === lastNextStopId);
 
    if (lastNextStop) {
      // If we have a valid last-known stop, check if we've arrived.
      const distanceToLast = calculateDistance(busLocation.lat, busLocation.lon, lastNextStop.lat, lastNextStop.lon);
      const isMovingAwayFromLast =
        lastDistanceToStop != null &&
        speedKmh >= STOPPED_SPEED_KMH_THRESHOLD &&
        distanceToLast > lastDistanceToStop + MOVING_AWAY_DELTA_METERS;
 
      if (distanceToLast <= ARRIVAL_RADIUS_METERS) {
        // We've arrived. Advance to the next stop in the sequence.
        const currentIndex = routeStops.findIndex(s => s.id === lastNextStop.id);
        const nextIndex = (currentIndex + 1) % routeStops.length;
        targetStop = routeStops[nextIndex];
      } else if (isMovingAwayFromLast && lastMovingAwayCount + 1 >= MOVING_AWAY_MIN_CONSECUTIVE) {
        // Bus is consistently moving away from the tracked next stop.
        // Treat that stop as passed and advance to avoid getting stuck.
        const currentIndex = routeStops.findIndex(s => s.id === lastNextStop.id);
        const nextIndex = (currentIndex + 1) % routeStops.length;
        targetStop = routeStops[nextIndex];
      } else {
        // Still on the way to the last-known stop.
        targetStop = lastNextStop;
        movingAwayCount = isMovingAwayFromLast ? lastMovingAwayCount + 1 : 0;
      }
    } else {
      // No state, so find the geographically nearest stop as a starting point.
      let nearestStop = null;
      let minDistance = Infinity;

      for (const stop of routeStops) {
        const dist = calculateDistance(busLocation.lat, busLocation.lon, stop.lat, stop.lon);
        // Ensure the distance is a valid number before comparing
        if (!isNaN(dist) && dist < minDistance) {
          minDistance = dist;
          nearestStop = stop;
        }
      }
      
      // If a nearest stop was found, use it. Otherwise, default to the first stop of the route.
      // This prevents errors if all distance calculations failed.
      targetStop = nearestStop || routeStops[0];
    }
 
    // Check for arrival at the *newly determined* target stop, in case the bus is sitting on top of it.
    let distanceToTarget = calculateDistance(
      busLocation.lat,
      busLocation.lon,
      targetStop.lat,
      targetStop.lon
    );

    if (distanceToTarget <= ARRIVAL_RADIUS_METERS && speedKmh < STOPPED_SPEED_KMH_THRESHOLD) {
      const currentIndex = routeStops.findIndex(s => s.id === targetStop.id);
      const nextIndex = (currentIndex + 1) % routeStops.length;
      targetStop = routeStops[nextIndex];
      distanceToTarget = calculateDistance(
        busLocation.lat,
        busLocation.lon,
        targetStop.lat,
        targetStop.lon
      );
      movingAwayCount = 0;
    }

    busNextStopState[busId] = {
      nextStopId: targetStop.id,
      lastDistanceToStop: Math.round(distanceToTarget),
      movingAwayCount,
      updatedAt: Date.now()
    };
    nextStop = targetStop;
  }

  // Distance is always measured to the computed "next" stop
  const distanceToNext = calculateDistance(
    busLocation.lat,
    busLocation.lon,
    nextStop.lat,
    nextStop.lon
  );

  const nextStopIndex = routeStops.findIndex(s => s.id === nextStop.id);
  const currentStopIndex = nextStopIndex >= 0
    ? (nextStopIndex - 1 + routeStops.length) % routeStops.length
    : -1;
  const currentStop = currentStopIndex >= 0 ? routeStops[currentStopIndex] : null;
  const distanceToCurrent = currentStop
    ? calculateDistance(busLocation.lat, busLocation.lon, currentStop.lat, currentStop.lon)
    : null;

  // Default: bus is considered "en route" to the next stop
  let eta = null;
  if (speedMs > 0) {
    eta = Math.round(distanceToNext / speedMs); // seconds
  }

  let serviceState = 'en_route';
  let nextRun = null;

  // Timetable-based "waiting at start" detection only applies when there is
  // no manual override in effect.
  if (!isManualOverride && FIXED_DEPARTURE_TIMES_MINUTES.length > 0) {
    const distanceToFirst = calculateDistance(
      busLocation.lat,
      busLocation.lon,
      firstStop.lat,
      firstStop.lon
    );

    const isNearStart = distanceToFirst <= START_WAIT_RADIUS_METERS;
    const isStopped = speedKmh < STOPPED_SPEED_KMH_THRESHOLD;

    // Find the next departure time (today) in minutes since midnight
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    let nextDepartureMinutes = null;
    for (const dep of FIXED_DEPARTURE_TIMES_MINUTES) {
      if (dep >= nowMinutes) {
        nextDepartureMinutes = dep;
        break;
      }
    }

    if (nextDepartureMinutes !== null) {
      const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const departureTime = new Date(todayMidnight.getTime() + nextDepartureMinutes * 60000);
      const secondsUntil = Math.max(0, Math.round((departureTime.getTime() - now.getTime()) / 1000));

      // Only switch to "waiting" mode if the bus is effectively parked at the
      // start stop and there is an upcoming departure.
      if (isNearStart && isStopped) {
        serviceState = 'waiting';
        eta = null; // we use nextRun.secondsUntil on the client instead
        nextRun = {
          time: minutesToHHMM(nextDepartureMinutes),
          departureMinutes: nextDepartureMinutes
        };
      }
    } else {
      // No more departures today
      serviceState = 'finished';
    }
  }

  res.json({
    trackerId,
    busId,
    routeId,
    currentStop: currentStop
      ? {
          ...currentStop,
          distance: Math.round(distanceToCurrent),
          stopNumber: currentStop.order
        }
      : null,
    nextStop: {
      ...nextStop,
      distance: Math.round(distanceToNext),
      eta: eta,
      isManualOverride,
      stopNumber: nextStop.order
    },
    currentSpeed: speedKmh ? speedKmh.toFixed(1) : '0', // km/h (already in km/h from OwnTracks)
    allStops: routeStops,
    serviceState,
    nextRun
  });
});

// Helper function to calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c; // Distance in meters
}

function minutesToHHMM(totalMinutes) {
  if (totalMinutes == null || Number.isNaN(totalMinutes)) return null;
  const minutesInDay = 24 * 60;
  const normalized = ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Normalize and parse various time formats into canonical 'HH:MM' and minutes
function normalizeTimeFormat(timeStr) {
  if (!timeStr) return null;
  if (typeof timeStr !== 'string') timeStr = String(timeStr);
  // Trim whitespace
  timeStr = timeStr.trim();

  // If already contains colon, try to parse HH:MM
  if (timeStr.includes(':')) {
    const parts = timeStr.split(':').map(p => p.trim());
    if (parts.length >= 2) {
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (!Number.isNaN(h) && !Number.isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
    }
    return null;
  }

  // Accept compact forms like '0830' or '830'
  const compact = timeStr.replace(/[^0-9]/g, '');
  if (/^\d{3,4}$/.test(compact)) {
    const h = parseInt(compact.slice(0, compact.length - 2), 10);
    const m = parseInt(compact.slice(-2), 10);
    if (!Number.isNaN(h) && !Number.isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  return null;
}

function parseTimeToMinutes(timeStr) {
  const normalized = normalizeTimeFormat(timeStr);
  if (!normalized) return null;
  const parts = normalized.split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

function isWithinOperatingHours(operatingHours, nowDate) {
  if (!operatingHours || !operatingHours.start || !operatingHours.end) return true;

  const startNorm = normalizeTimeFormat(operatingHours.start);
  const endNorm = normalizeTimeFormat(operatingHours.end);
  if (!startNorm || !endNorm) return true;

  const startMin = parseTimeToMinutes(startNorm);
  const endMin = parseTimeToMinutes(endNorm);
  if (startMin === null || endMin === null) return true;
  const currentMin = nowDate.getHours() * 60 + nowDate.getMinutes();

  if (startMin <= endMin) {
    return currentMin >= startMin && currentMin <= endMin;
  } else {
    // Overnight range (e.g., 22:00 - 04:00)
    return currentMin >= startMin || currentMin <= endMin;
  }
}

// Helper function to parse KML file (Google Maps exported routes)
function parseKML(kmlContent) {
  const routes = [];
  const stops = [];
  
  // Extract LineStrings (routes/paths)
  const lineStringRegex = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  let match;
  
  while ((match = lineStringRegex.exec(kmlContent)) !== null) {
    const placemark = match[1];
    
    // Get name
    const nameMatch = /<name><!\[CDATA\[(.*?)\]\]><\/name>|<name>(.*?)<\/name>/i.exec(placemark);
    const name = nameMatch ? (nameMatch[1] || nameMatch[2]) : 'Unnamed';
    
    // Check for LineString (route)
    const coordinatesMatch = /<LineString>([\s\S]*?)<coordinates>([\s\S]*?)<\/coordinates>([\s\S]*?)<\/LineString>/i.exec(placemark);
    if (coordinatesMatch) {
      const coordsText = coordinatesMatch[2].trim();
      const coordinates = coordsText.split(/\s+/).map(coord => {
        const [lon, lat, alt] = coord.split(',').map(Number);
        return [lat, lon];
      }).filter(coord => !isNaN(coord[0]) && !isNaN(coord[1]));
      
      if (coordinates.length > 0) {
        routes.push({
          name: name,
          coordinates: coordinates,
          waypoints: coordinates,
          color: '#3388ff'
        });
      }
    }
    
    // Check for Point (stop/placemark)
    const pointMatch = /<Point>([\s\S]*?)<coordinates>([\s\S]*?)<\/coordinates>([\s\S]*?)<\/Point>/i.exec(placemark);
    if (pointMatch) {
      const coordsText = pointMatch[2].trim();
      const [lon, lat, alt] = coordsText.split(',').map(Number);
      
      if (!isNaN(lat) && !isNaN(lon)) {
        stops.push({
          name: name,
          lat: lat,
          lon: lon,
          order: stops.length
        });
      }
    }
  }
  
  return { routes, stops };
}

// Helper function to parse CSV file (Google Maps exported places)
function parseCSV(csvContent) {
  const lines = csvContent.split('\n');
  const stops = [];
  
  // Try to find header row
  let headerIndex = -1;
  let headers = [];
  
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i].toLowerCase();
    if (line.includes('latitude') && line.includes('longitude')) {
      headerIndex = i;
      headers = lines[i].split(',').map(h => h.trim().replace(/"/g, ''));
      break;
    }
  }
  
  if (headerIndex === -1) {
    // Try without header - assume format: name, lat, lon
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 3) {
        const lat = parseFloat(parts[1]);
        const lon = parseFloat(parts[2]);
        if (!isNaN(lat) && !isNaN(lon)) {
          stops.push({
            name: parts[0].replace(/"/g, '').trim() || `Stop ${i + 1}`,
            lat: lat,
            lon: lon,
            order: stops.length
          });
        }
      }
    }
  } else {
    // Parse with headers
    const nameIdx = headers.findIndex(h => h.toLowerCase().includes('name') || h.toLowerCase().includes('title'));
    const latIdx = headers.findIndex(h => h.toLowerCase().includes('latitude') || h.toLowerCase() === 'lat');
    const lonIdx = headers.findIndex(h => h.toLowerCase().includes('longitude') || h.toLowerCase() === 'lon' || h.toLowerCase() === 'lng');
    
    for (let i = headerIndex + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      
      const parts = lines[i].split(',');
      const lat = parseFloat(parts[latIdx]);
      const lon = parseFloat(parts[lonIdx]);
      
      if (!isNaN(lat) && !isNaN(lon)) {
        stops.push({
          name: (nameIdx >= 0 ? parts[nameIdx] : `Stop ${stops.length + 1}`).replace(/"/g, '').trim(),
          lat: lat,
          lon: lon,
          order: stops.length
        });
      }
    }
  }
  
  return { stops };
}

// Import routes/stops from Google Maps export (KML or CSV)
app.post('/api/import/google-maps', upload.single('file'), basicAuth, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  try {
    const fileContent = fs.readFileSync(req.file.path, 'utf8');
    const fileName = req.file.originalname.toLowerCase();
    
    // Get color from form data, default to blue if not provided
    const routeColor = req.body.color || '#3388ff';
    
    let result = { routes: [], stops: [] };
    
    if (fileName.endsWith('.kml')) {
      result = parseKML(fileContent);
    } else if (fileName.endsWith('.csv')) {
      result = parseCSV(fileContent);
    } else {
      // Try to auto-detect
      if (fileContent.includes('<?xml') || fileContent.includes('<kml')) {
        result = parseKML(fileContent);
      } else {
        result = parseCSV(fileContent);
      }
    }
    
    // Add imported routes to the system
    const addedRoutes = [];
    if (result.routes) {
      result.routes.forEach(route => {
        const newRoute = {
          id: `route-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: route.name,
          coordinates: route.coordinates,
          waypoints: route.waypoints,
          color: routeColor, // Use color from color picker
          visible: true, // Routes are visible by default
          createdAt: new Date().toISOString()
        };
        routes.push(newRoute);
        addedRoutes.push(newRoute);
      });
    }
    
    // Add imported stops to the system
    const addedStops = [];
    if (result.stops) {
      result.stops.forEach(stop => {
        const newStop = {
          id: `stop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: stop.name,
          lat: stop.lat,
          lon: stop.lon,
          routeId: stop.routeId || null,
          order: stop.order,
          createdAt: new Date().toISOString()
        };
        stops.push(newStop);
        addedStops.push(newStop);
      });
    }
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    dataChanged = true;
    res.json({
      success: true,
      routes: addedRoutes,
      stops: addedStops,
      message: `Imported ${addedRoutes.length} route(s) and ${addedStops.length} stop(s)`
    });
    
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }
    
    console.error('Error parsing file:', error);
    res.status(500).json({ error: 'Failed to parse file: ' + error.message });
  }
});

// Serve the map page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Embeddable map page
app.get('/embed', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'embed.html'));
});

// Health check endpoint (for Railway/monitoring)
app.get('/health', (req, res) => {
  // Count only visible trackers (respecting operating hours)
  const now = new Date();
  let visibleCount = 0;
  Object.keys(busLocations).forEach(trackerId => {
    const busId = busAssignments[trackerId];
    if (!busId) {
      return;
    }

    const bus = buses.find(b => b.id === busId);
    if (!bus) {
      return;
    }

    const routeId = busRouteAssignments[busId];
    if (!routeId) {
      return;
    }

    if (bus.operatingHours && !isWithinOperatingHours(bus.operatingHours, now)) {
      return; // not visible
    }

    visibleCount++;
  });

  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    buses: visibleCount,
    routes: routes.length
  });
});

// Admin panel (protected with basic auth)
app.get('/admin', basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`OpenTop Tracker server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown - save data on exit
process.on('SIGINT', () => {
  console.log('\n\nSaving data before shutdown...');
  saveData();
  console.log('Data saved. Goodbye!');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nSaving data before shutdown...');
  saveData();
  process.exit(0);
});

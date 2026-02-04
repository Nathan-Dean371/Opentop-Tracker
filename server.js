const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
// Serve Leaflet from node_modules
app.use('/leaflet', express.static(path.join(__dirname, 'node_modules/leaflet/dist')));

// In-memory storage for bus locations, routes, stops, and bus assignments
let busLocations = {};
let routes = [];
let stops = [];
let buses = [];
let busAssignments = {}; // Maps tracker ID to bus ID
let busRouteAssignments = {}; // Maps bus ID to route ID

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
  res.json(busLocations);
});

// Sample route data endpoint
app.get('/api/routes', (req, res) => {
  res.json(routes);
});

// Add a new route
app.post('/api/routes', (req, res) => {
  const { name, coordinates, color, waypoints } = req.body;
  const route = {
    id: `route-${Date.now()}`,
    name,
    coordinates,
    waypoints: waypoints || coordinates,  // Store original waypoints for editing
    color: color || '#3388ff',
    createdAt: new Date().toISOString()
  };
  routes.push(route);
  res.status(201).json(route);
});

// Update a route
app.put('/api/routes/:id', (req, res) => {
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
  
  res.json(routes[routeIndex]);
});

// Delete a route
app.delete('/api/routes/:id', (req, res) => {
  const { id } = req.params;
  const routeIndex = routes.findIndex(r => r.id === id);
  
  if (routeIndex === -1) {
    return res.status(404).json({ error: 'Route not found' });
  }
  
  routes.splice(routeIndex, 1);
  res.status(204).send();
});

// Get all stops
app.get('/api/stops', (req, res) => {
  res.json(stops);
});

// Add a new stop
app.post('/api/stops', (req, res) => {
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
  res.status(201).json(stop);
});

// Update a stop
app.put('/api/stops/:id', (req, res) => {
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
  
  res.json(stops[stopIndex]);
});

// Delete a stop
app.delete('/api/stops/:id', (req, res) => {
  const { id } = req.params;
  const stopIndex = stops.findIndex(s => s.id === id);
  
  if (stopIndex === -1) {
    return res.status(404).json({ error: 'Stop not found' });
  }
  
  stops.splice(stopIndex, 1);
  res.status(204).send();
});

// Get all buses
app.get('/api/buses', (req, res) => {
  res.json(buses);
});

// Add a new bus
app.post('/api/buses', (req, res) => {
  const { name, number, trackerId } = req.body;
  const bus = {
    id: `bus-${Date.now()}`,
    name,
    number,
    trackerId,
    createdAt: new Date().toISOString()
  };
  buses.push(bus);
  
  if (trackerId) {
    busAssignments[trackerId] = bus.id;
  }
  
  res.status(201).json(bus);
});

// Update a bus
app.put('/api/buses/:id', (req, res) => {
  const { id } = req.params;
  const { name, number, trackerId } = req.body;
  const busIndex = buses.findIndex(b => b.id === id);
  
  if (busIndex === -1) {
    return res.status(404).json({ error: 'Bus not found' });
  }
  
  // Remove old tracker assignment
  if (buses[busIndex].trackerId) {
    delete busAssignments[buses[busIndex].trackerId];
  }
  
  buses[busIndex] = {
    ...buses[busIndex],
    name: name || buses[busIndex].name,
    number: number || buses[busIndex].number,
    trackerId: trackerId || buses[busIndex].trackerId
  };
  
  // Add new tracker assignment
  if (trackerId) {
    busAssignments[trackerId] = id;
  }
  
  res.json(buses[busIndex]);
});

// Delete a bus
app.delete('/api/buses/:id', (req, res) => {
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
  
  buses.splice(busIndex, 1);
  res.status(204).send();
});

// Assign bus to route
app.post('/api/buses/:busId/assign-route', (req, res) => {
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
  res.json({ busId, routeId, message: 'Bus assigned to route successfully' });
});

// Get bus assignments
app.get('/api/assignments', (req, res) => {
  res.json({
    busAssignments,
    busRouteAssignments
  });
});

// Calculate ETA to next stop
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
  
  // Find next stop based on distance
  let nextStop = null;
  let minDistance = Infinity;
  
  routeStops.forEach(stop => {
    const distance = calculateDistance(
      busLocation.lat,
      busLocation.lon,
      stop.lat,
      stop.lon
    );
    
    if (distance < minDistance) {
      minDistance = distance;
      nextStop = stop;
    }
  });
  
  // Calculate ETA based on current speed and distance
  const speed = busLocation.velocity || 0; // m/s
  let eta = null;
  
  if (speed > 0) {
    eta = Math.round(minDistance / speed); // seconds
  }
  
  res.json({
    trackerId,
    busId,
    routeId,
    nextStop: {
      ...nextStop,
      distance: Math.round(minDistance),
      eta: eta
    },
    currentSpeed: speed ? (speed * 3.6).toFixed(1) : '0', // km/h
    allStops: routeStops
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

// Serve the map page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Embeddable map page
app.get('/embed', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'embed.html'));
});

// Admin panel
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`OpenTop Tracker server running on port ${PORT}`);
  console.log(`Map available at: http://localhost:${PORT}`);
  console.log(`Admin panel at: http://localhost:${PORT}/admin`);
  console.log(`Embeddable map at: http://localhost:${PORT}/embed`);
  console.log(`OwnTracks webhook endpoint: http://localhost:${PORT}/owntracks`);
});

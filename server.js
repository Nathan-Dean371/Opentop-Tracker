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
  res.json(busLocations);
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
  
  dataChanged = true;
  res.status(201).json(bus);
});

// Update a bus
app.put('/api/buses/:id', basicAuth, (req, res) => {
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
  
  buses.splice(busIndex, 1);
  dataChanged = true;
  res.status(204).send();
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
  dataChanged = true;
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
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    buses: Object.keys(busLocations).length,
    routes: routes.length
  });
});

// Admin panel (protected with basic auth)
app.get('/admin', basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`OpenTop Tracker server running on port ${PORT}`);
  console.log(`Map available at: http://localhost:${PORT}`);
  console.log(`Admin panel at: http://localhost:${PORT}/admin`);
  console.log(`Embeddable map at: http://localhost:${PORT}/embed`);
  console.log(`OwnTracks webhook endpoint: http://localhost:${PORT}/owntracks`);
  console.log(`\n🔐 Admin credentials: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD === 'opentop123' ? ADMIN_PASSWORD + ' (default - change in production!)' : '***'}`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown - save data on exit
process.on('SIGINT', () => {
  console.log('\n\n💾 Saving data before shutdown...');
  saveData();
  console.log('✅ Data saved. Goodbye!');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n💾 Saving data before shutdown...');
  saveData();
  process.exit(0);
});

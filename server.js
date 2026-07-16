const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const mqtt = require('mqtt');

const app = express();
// These endpoints are real-time and clients expect JSON bodies.
// Disable ETag/304 caching to avoid empty-body 304 responses.
app.set('etag', false);
const PORT = process.env.PORT || 3100;

// Prevent intermediary/proxy caching for API + webhook endpoints
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/owntracks' || req.path === '/owntracks/') {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

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
// OwnTracks sometimes posts without a JSON content-type, so accept raw text on this path too.
app.use('/owntracks', express.text({ type: '*/*', limit: '10mb' }));

// Ensure JSON parse errors return JSON (some clients expect JSON responses)
app.use((err, req, res, next) => {
  if (err && err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ success: false, error: 'invalid_json' });
  }
  next(err);
});
app.use(express.static('public'));
// Serve Leaflet from node_modules
app.use('/leaflet', express.static(path.join(__dirname, 'node_modules/leaflet/dist')));

// Data file path - use Railway volume if available, otherwise current directory
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const SERVICE_TIME_ZONE = process.env.SERVICE_TIME_ZONE || 'Europe/Dublin';

// OwnTracks / location ingestion guards
// - LOCATION_MAX_STALE_SECONDS: drop points older than this (prevents queued/backfilled locations from taking over)
// - LOCATION_MAX_OUT_OF_ORDER_SECONDS: allow minor reordering jitter without dropping
const LOCATION_MAX_STALE_SECONDS = Number.isFinite(parseInt(process.env.LOCATION_MAX_STALE_SECONDS, 10))
  ? parseInt(process.env.LOCATION_MAX_STALE_SECONDS, 10)
  : 900; // 15 minutes
const LOCATION_MAX_OUT_OF_ORDER_SECONDS = Number.isFinite(parseInt(process.env.LOCATION_MAX_OUT_OF_ORDER_SECONDS, 10))
  ? parseInt(process.env.LOCATION_MAX_OUT_OF_ORDER_SECONDS, 10)
  : 30;

// MQTT ingestion (optional, enabled when MQTT_BROKER_URL is set)
const MQTT_BROKER_URL = (process.env.MQTT_BROKER_URL || '').trim();
const MQTT_TOPIC = (process.env.MQTT_TOPIC || 'owntracks/+/+').trim();
const MQTT_CLIENT_ID = (process.env.MQTT_CLIENT_ID || `opentop-backend-${Math.random().toString(16).slice(2, 10)}`).trim();
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_KEEPALIVE_SECONDS = Number.isFinite(parseInt(process.env.MQTT_KEEPALIVE_SECONDS, 10))
  ? parseInt(process.env.MQTT_KEEPALIVE_SECONDS, 10)
  : 60;
const MQTT_RECONNECT_PERIOD_MS = Number.isFinite(parseInt(process.env.MQTT_RECONNECT_PERIOD_MS, 10))
  ? parseInt(process.env.MQTT_RECONNECT_PERIOD_MS, 10)
  : 5000;
const MQTT_CONNECT_TIMEOUT_MS = Number.isFinite(parseInt(process.env.MQTT_CONNECT_TIMEOUT_MS, 10))
  ? parseInt(process.env.MQTT_CONNECT_TIMEOUT_MS, 10)
  : 30000;
const MQTT_CLEAN_SESSION = String(process.env.MQTT_CLEAN_SESSION || 'false').toLowerCase() === 'true';
const MQTT_TLS_REJECT_UNAUTHORIZED = String(process.env.MQTT_TLS_REJECT_UNAUTHORIZED || 'false').toLowerCase() === 'true';

let mqttClient = null;
const mqttState = {
  enabled: Boolean(MQTT_BROKER_URL),
  connected: false,
  topic: MQTT_TOPIC,
  received: 0,
  accepted: 0,
  dropped: 0,
  parseErrors: 0,
  lastMessageAt: null,
  lastError: null
};

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
// NOTE: Schedule is now per-bus via bus.departureTimes (HH:MM strings).
// The old hardcoded list has been removed intentionally.

const START_WAIT_RADIUS_METERS = 100; // how close to first stop counts as "at start"
const STOPPED_SPEED_KMH_THRESHOLD = 2; // below this is treated as stopped
const ARRIVAL_RADIUS_METERS = 50; // distance within which we consider a stop "reached"
const FORWARD_ADVANCE_MARGIN_METERS = 120; // next stop must be meaningfully closer before auto-advance
const MIN_AUTO_ADVANCE_INTERVAL_MS = 20000; // prevent rapid multi-stop jumps from sparse polling
const MISMATCH_RESYNC_INDEX_GAP = 2; // minimum stop-index disagreement before mismatch is counted
const MISMATCH_RESYNC_SAMPLE_COUNT = 3; // consecutive mismatches required before re-sync
const PROGRESSION_SAMPLE_BUFFER_SIZE = 8; // retain a short ring buffer for debugging decisions
const MIN_RESYNC_INTERVAL_MS = 15000; // avoid rapid repeated re-syncing
const PROJECTION_MAX_DISTANCE_METERS = 120; // beyond this, route projection is considered low confidence
const ARRIVAL_CONFIRMATION_SAMPLES = 2; // consecutive near+slow samples needed to confirm dwell arrival
const MIN_DWELL_SECONDS = 6; // minimum near+slow dwell duration before promoting arrival transition
const PASS_MARGIN_METERS = 35; // consider a stop passed once bus progress moves beyond this margin
const MIN_PROGRESS_DELTA_FOR_REVERSE_METERS = 20; // ignore tiny progress fluctuations when inferring reverse motion
const REVERSE_HEADING_DELTA_DEGREES = 120; // heading opposite route direction above this implies reverse travel

const SERVICE_STATE = Object.freeze({
  EN_ROUTE: 'en_route',
  WAITING: 'waiting',
  FINISHED: 'finished'
});

const PROGRESSION_STATE = Object.freeze({
  INITIALIZING: 'initializing',
  EN_ROUTE: 'en_route',
  DWELL_AT_STOP: 'dwell_at_stop',
  WAITING_START: 'waiting_start',
  OFF_ROUTE_RECOVERY: 'off_route_recovery'
});

function getServiceStateLabel(serviceState) {
  switch (serviceState) {
    case SERVICE_STATE.WAITING:
      return 'Waiting for Next Tour to Start';
    case SERVICE_STATE.FINISHED:
      return 'Service Finished for Today';
    case SERVICE_STATE.EN_ROUTE:
    default:
      return 'En Route';
  }
}

function normalizeBusVisibilityMode(value) {
  return String(value || '').toLowerCase() === 'debug' ? 'debug' : 'public';
}

function isPublicBus(bus) {
  return normalizeBusVisibilityMode(bus && bus.visibilityMode) === 'public';
}

function normalizeStopNavigateUrl(value, allowUndefined = false) {
  if (value === undefined) {
    return allowUndefined ? undefined : null;
  }

  if (value === null) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  return normalized;
}

function isValidNavigateUrl(url) {
  return /^https?:\/\//i.test(url);
}

function normalizeDepartureTimesInput(departureTimes) {
  // Accept: array of strings OR a single comma/semicolon/newline-separated string.
  // Output: canonical array of 'HH:MM' strings (24h, zero padded), sorted, de-duped.
  const rawParts = [];
  if (Array.isArray(departureTimes)) {
    departureTimes.forEach(v => {
      if (typeof v === 'string') rawParts.push(v);
      else if (v != null) rawParts.push(String(v));
    });
  } else if (typeof departureTimes === 'string') {
    departureTimes
      .split(/[\n,;]+/)
      .forEach(v => rawParts.push(v));
  } else if (departureTimes != null) {
    rawParts.push(String(departureTimes));
  }

  const seen = new Set();
  const minutesList = [];
  rawParts
    .map(s => (typeof s === 'string' ? s.trim() : String(s).trim()))
    .filter(Boolean)
    .forEach(s => {
      const norm = normalizeTimeFormat(s);
      const mins = norm ? parseTimeToMinutes(norm) : null;
      if (mins == null) return;
      if (seen.has(mins)) return;
      seen.add(mins);
      minutesList.push(mins);
    });

  minutesList.sort((a, b) => a - b);
  return minutesList.map(minutesToHHMM);
}

function getDepartureMinutesForBus(bus) {
  if (!bus || !Array.isArray(bus.departureTimes)) return [];
  const minutes = [];
  const seen = new Set();
  bus.departureTimes.forEach(t => {
    if (typeof t !== 'string') return;
    const norm = normalizeTimeFormat(t);
    const mins = norm ? parseTimeToMinutes(norm) : null;
    if (mins == null) return;
    if (seen.has(mins)) return;
    seen.add(mins);
    minutes.push(mins);
  });
  minutes.sort((a, b) => a - b);
  return minutes;
}

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

          // Normalize any existing departureTimes (per-bus timetable)
          if (b) {
            if (b.departureTimes !== undefined) {
              const normalized = normalizeDepartureTimesInput(b.departureTimes);
              // Persist canonical array form
              if (!Array.isArray(b.departureTimes) || JSON.stringify(b.departureTimes) !== JSON.stringify(normalized)) {
                b.departureTimes = normalized;
                migrated = true;
              }
            } else {
              // Explicitly store empty list for older data files (no fallback to defaults)
              b.departureTimes = [];
              migrated = true;
            }

            const normalizedVisibilityMode = normalizeBusVisibilityMode(b.visibilityMode);
            if (b.visibilityMode !== normalizedVisibilityMode) {
              b.visibilityMode = normalizedVisibilityMode;
              migrated = true;
            }
          }
        });

        if (migrated) {
          dataChanged = true;
          saveData();
          console.log('🔧 Migrated bus operatingHours and departureTimes to canonical formats');
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

function ingestOwnTracksLocation(data, source = 'http', sourceRef = null) {
  if (!data || typeof data !== 'object') {
    return { accepted: false, reason: 'invalid_payload' };
  }

  if (data._type !== 'location') {
    return { accepted: false, reason: 'not_location' };
  }

  const deviceId = data.tid || 'default';
  const lat = Number(data.lat);
  const lon = Number(data.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { accepted: false, reason: 'invalid_coordinates' };
  }

  const receivedAtSeconds = Math.floor(Date.now() / 1000);
  const deviceTimestamp = Number.isFinite(parseInt(data.tst, 10)) ? parseInt(data.tst, 10) : null;

  // Reject stale/backfilled points (e.g., store-and-forward queue dumps)
  if (deviceTimestamp != null) {
    const stalenessSeconds = receivedAtSeconds - deviceTimestamp;
    if (stalenessSeconds > LOCATION_MAX_STALE_SECONDS) {
      console.warn(
        `🧹 Ignoring stale ${source} location for ${deviceId} (stale by ${stalenessSeconds}s > ${LOCATION_MAX_STALE_SECONDS}s)`
      );
      return { accepted: false, reason: 'stale' };
    }
  }

  // Reject out-of-order points beyond a small jitter allowance
  const prev = busLocations[deviceId];
  const prevDeviceTimestamp = prev && Number.isFinite(parseInt(prev.deviceTimestamp, 10))
    ? parseInt(prev.deviceTimestamp, 10)
    : (prev && Number.isFinite(parseInt(prev.timestamp, 10)) ? parseInt(prev.timestamp, 10) : null);

  if (deviceTimestamp != null && prevDeviceTimestamp != null) {
    if (deviceTimestamp < (prevDeviceTimestamp - LOCATION_MAX_OUT_OF_ORDER_SECONDS)) {
      console.warn(
        `⏪ Ignoring out-of-order ${source} location for ${deviceId} (tst=${deviceTimestamp} < prev=${prevDeviceTimestamp} - ${LOCATION_MAX_OUT_OF_ORDER_SECONDS}s)`
      );
      return { accepted: false, reason: 'out_of_order' };
    }
  }

  // During dual-ingestion migration, the same location may arrive via both HTTP and MQTT.
  // Drop exact duplicates to avoid churn in telemetry.
  if (
    prev &&
    deviceTimestamp != null &&
    prev.deviceTimestamp != null &&
    Number(prev.deviceTimestamp) === deviceTimestamp &&
    Number(prev.lat) === lat &&
    Number(prev.lon) === lon
  ) {
    return { accepted: false, reason: 'duplicate' };
  }

  busLocations[deviceId] = {
    lat,
    lon,
    // Use server receive time for freshness/"Updated ... ago" calculations
    timestamp: receivedAtSeconds,
    // Preserve device timestamp separately for debugging/inspection
    deviceTimestamp,
    receivedAt: receivedAtSeconds,
    battery: data.batt,
    accuracy: data.acc,
    velocity: data.vel,
    altitude: data.alt,
    source,
    sourceRef: sourceRef || null
  };

  console.log(`Location update accepted for device ${deviceId} via ${source}:`, busLocations[deviceId]);
  return { accepted: true, reason: 'accepted' };
}

function setupMqttIngestion() {
  if (!MQTT_BROKER_URL) {
    console.log('ℹ️ MQTT ingestion disabled (MQTT_BROKER_URL not set). HTTP /owntracks remains active.');
    return;
  }

  const options = {
    clientId: MQTT_CLIENT_ID,
    reconnectPeriod: MQTT_RECONNECT_PERIOD_MS,
    connectTimeout: MQTT_CONNECT_TIMEOUT_MS,
    keepalive: MQTT_KEEPALIVE_SECONDS,
    clean: MQTT_CLEAN_SESSION,
    reschedulePings: true,
    rejectUnauthorized: MQTT_TLS_REJECT_UNAUTHORIZED
  };

  if (MQTT_USERNAME) {
    options.username = MQTT_USERNAME;
  }

  if (MQTT_PASSWORD) {
    options.password = MQTT_PASSWORD;
  }

  mqttClient = mqtt.connect(MQTT_BROKER_URL, options);

  mqttClient.on('connect', () => {
    mqttState.connected = true;
    mqttState.lastError = null;
    console.log(`✅ Connected to MQTT broker at ${MQTT_BROKER_URL} (keepalive=${MQTT_KEEPALIVE_SECONDS}s, clean=${MQTT_CLEAN_SESSION})`);
    mqttClient.subscribe(MQTT_TOPIC, { qos: 1 }, (err) => {
      if (err) {
        mqttState.lastError = err.message;
        console.error(`⚠️ Failed to subscribe to MQTT topic ${MQTT_TOPIC}:`, err.message);
        return;
      }
      console.log(`📡 Subscribed to MQTT topic: ${MQTT_TOPIC} (qos=1)`);
    });
  });

  mqttClient.on('reconnect', () => {
    mqttState.connected = false;
    console.log('🔄 Reconnecting to MQTT broker...');
  });

  mqttClient.on('error', (error) => {
    mqttState.lastError = error.message;
    console.error('⚠️ MQTT client error:', error.message);
  });

  mqttClient.on('offline', () => {
    mqttState.connected = false;
    console.warn('⚠️ MQTT client is offline');
  });

  mqttClient.on('close', () => {
    mqttState.connected = false;
    console.warn('⚠️ MQTT connection closed');
  });

  mqttClient.on('disconnect', (packet) => {
    mqttState.connected = false;
    console.warn(`⚠️ MQTT disconnect received from broker (reasonCode=${packet && packet.reasonCode != null ? packet.reasonCode : 'n/a'})`);
  });

  mqttClient.on('message', (topic, message) => {
    mqttState.received += 1;
    mqttState.lastMessageAt = new Date().toISOString();

    let payload = null;
    try {
      payload = JSON.parse(message.toString());
    } catch (error) {
      mqttState.parseErrors += 1;
      mqttState.dropped += 1;
      console.warn('⚠️ MQTT message parse failed:', error.message);
      return;
    }

    const result = ingestOwnTracksLocation(payload, 'mqtt', topic);
    if (result.accepted) {
      mqttState.accepted += 1;
    } else {
      mqttState.dropped += 1;
    }
  });
}

// OwnTracks webhook endpoint
app.get(['/owntracks', '/owntracks/'], (req, res) => {
  res.status(200).json({ success: true, message: 'OwnTracks endpoint ready. Send POST with JSON body.' });
});

app.post(['/owntracks', '/owntracks/'], (req, res) => {
  let data = req.body;

  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (error) {
      console.warn('⚠️ OwnTracks sent invalid JSON payload:', error.message);
      return res.status(200).end();
    }
  }

  if (!data || typeof data !== 'object') {
    return res.status(200).end();
  }

  ingestOwnTracksLocation(data, 'http');
  
  res.status(200).json([]);
});

// Get current bus locations
app.get('/api/locations', (req, res) => {
  // Only return trackers that are currently within their bus operating hours
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

    if (!isPublicBus(bus)) {
      return;
    }

    const routeId = busRouteAssignments[busId];
    if (!routeId) {
      return;
    }

    if (bus.operatingHours && !isWithinOperatingHours(bus.operatingHours)) {
      // Skip this tracker — outside operating hours
      return;
    }

    visibleLocations[trackerId] = location;
  });

  res.json(visibleLocations);
});

// Admin-only live locations (includes both public and debug buses)
app.get('/api/admin/locations', basicAuth, (req, res) => {
  const visibleLocations = {};

  Object.keys(busLocations).forEach(trackerId => {
    const location = busLocations[trackerId];
    const busId = busAssignments[trackerId];

    // Keep this admin feed focused on trackers that are assigned to a known bus.
    if (!busId) {
      return;
    }

    const bus = buses.find(b => b.id === busId);
    if (!bus) {
      return;
    }

    const routeId = busRouteAssignments[busId] || null;
    const route = routeId ? routes.find(r => r.id === routeId) : null;

    visibleLocations[trackerId] = {
      ...location,
      trackerId,
      busId,
      busName: bus.name || null,
      busNumber: bus.number || null,
      visibilityMode: normalizeBusVisibilityMode(bus.visibilityMode),
      routeId,
      routeName: route ? route.name : null
    };
  });

  res.json(visibleLocations);
});

// Sample route data endpoint
app.get('/api/routes', (req, res) => {
  res.json(routes);
});

// Add a new route
app.post('/api/routes', basicAuth, (req, res) => {
  const { name, coordinates, color, waypoints, startStopId, endStopId, isLoop } = req.body;
  const route = {
    id: `route-${Date.now()}`,
    name,
    coordinates,
    waypoints: waypoints || coordinates,  // Store original waypoints for editing
    color: color || '#3388ff',
    startStopId: startStopId || null,
    endStopId: endStopId || null,
    isLoop: isLoop === undefined ? true : Boolean(isLoop),
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
  const { name, coordinates, color, startStopId, endStopId, isLoop } = req.body;
  const routeIndex = routes.findIndex(r => r.id === id);
  
  if (routeIndex === -1) {
    return res.status(404).json({ error: 'Route not found' });
  }
  
  routes[routeIndex] = {
    ...routes[routeIndex],
    name: name || routes[routeIndex].name,
    coordinates: coordinates || routes[routeIndex].coordinates,
    color: color || routes[routeIndex].color,
    startStopId: startStopId !== undefined ? startStopId : routes[routeIndex].startStopId,
    endStopId: endStopId !== undefined ? endStopId : routes[routeIndex].endStopId,
    isLoop: isLoop !== undefined ? Boolean(isLoop) : (routes[routeIndex].isLoop !== undefined ? routes[routeIndex].isLoop : true)
  };
  
  Object.keys(busRouteAssignments).forEach(busId => {
    if (busRouteAssignments[busId] === id) {
      delete manualNextStops[busId];
      delete busNextStopState[busId];
    }
  });

  dataChanged = true;
  res.json(routes[routeIndex]);
});

// Configure progression (start/end/loop) for a route
app.post('/api/routes/:id/progression', basicAuth, (req, res) => {
  const { id } = req.params;
  const { startStopId, endStopId, isLoop } = req.body;

  const routeIndex = routes.findIndex(r => r.id === id);
  if (routeIndex === -1) {
    return res.status(404).json({ error: 'Route not found' });
  }

  routes[routeIndex] = {
    ...routes[routeIndex],
    startStopId: startStopId !== undefined ? (startStopId || null) : (routes[routeIndex].startStopId || null),
    endStopId: endStopId !== undefined ? (endStopId || null) : (routes[routeIndex].endStopId || null),
    isLoop: isLoop !== undefined ? Boolean(isLoop) : (routes[routeIndex].isLoop !== undefined ? routes[routeIndex].isLoop : true)
  };

  Object.keys(busRouteAssignments).forEach(busId => {
    if (busRouteAssignments[busId] === id) {
      delete manualNextStops[busId];
      delete busNextStopState[busId];
    }
  });

  dataChanged = true;
  res.json({
    routeId: id,
    startStopId: routes[routeIndex].startStopId,
    endStopId: routes[routeIndex].endStopId,
    isLoop: routes[routeIndex].isLoop,
    message: 'Route progression settings updated'
  });
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
  const { name, lat, lon, routeId, order, googleMapsNavigateUrl } = req.body;
  const normalizedNavigateUrl = normalizeStopNavigateUrl(googleMapsNavigateUrl);
  if (normalizedNavigateUrl && !isValidNavigateUrl(normalizedNavigateUrl)) {
    return res.status(400).json({ error: 'googleMapsNavigateUrl must start with http:// or https://' });
  }

  const stop = {
    id: `stop-${Date.now()}`,
    name,
    lat,
    lon,
    routeId,
    order: order || 0,
    googleMapsNavigateUrl: normalizedNavigateUrl,
    createdAt: new Date().toISOString()
  };
  stops.push(stop);
  dataChanged = true;
  res.status(201).json(stop);
});

// Update a stop
app.put('/api/stops/:id', basicAuth, (req, res) => {
  const { id } = req.params;
  const { name, lat, lon, routeId, order, googleMapsNavigateUrl } = req.body;
  const stopIndex = stops.findIndex(s => s.id === id);
  
  if (stopIndex === -1) {
    return res.status(404).json({ error: 'Stop not found' });
  }
  
  const normalizedNavigateUrl = normalizeStopNavigateUrl(googleMapsNavigateUrl, true);
  if (normalizedNavigateUrl && !isValidNavigateUrl(normalizedNavigateUrl)) {
    return res.status(400).json({ error: 'googleMapsNavigateUrl must start with http:// or https://' });
  }

  stops[stopIndex] = {
    ...stops[stopIndex],
    name: name || stops[stopIndex].name,
    lat: lat !== undefined ? lat : stops[stopIndex].lat,
    lon: lon !== undefined ? lon : stops[stopIndex].lon,
    routeId: routeId || stops[stopIndex].routeId,
    order: order !== undefined ? order : stops[stopIndex].order,
    googleMapsNavigateUrl: normalizedNavigateUrl !== undefined
      ? normalizedNavigateUrl
      : (stops[stopIndex].googleMapsNavigateUrl || null)
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
  
  for (let index = 0; index < stopsToAdd.length; index++) {
    const normalizedNavigateUrl = normalizeStopNavigateUrl(stopsToAdd[index].googleMapsNavigateUrl);
    if (normalizedNavigateUrl && !isValidNavigateUrl(normalizedNavigateUrl)) {
      return res.status(400).json({ error: `Invalid googleMapsNavigateUrl for stop index ${index}` });
    }
  }

  const addedStops = [];
  stopsToAdd.forEach((stopData, index) => {
    const normalizedNavigateUrl = normalizeStopNavigateUrl(stopData.googleMapsNavigateUrl);

    const stop = {
      id: `stop-${Date.now()}-${index}`,
      name: stopData.name,
      lat: stopData.lat,
      lon: stopData.lon,
      routeId: stopData.routeId,
      order: stopData.order || 0,
      googleMapsNavigateUrl: normalizedNavigateUrl,
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
      googleMapsNavigateUrl: null,
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
  const { name, number, trackerId, operatingHours, departureTimes, visibilityMode } = req.body;

  const normalizedDepartureTimes = normalizeDepartureTimesInput(departureTimes);
  if (!Array.isArray(normalizedDepartureTimes) || normalizedDepartureTimes.length === 0) {
    return res.status(400).json({ error: 'departureTimes is required (provide at least one HH:MM time)' });
  }
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
    visibilityMode: normalizeBusVisibilityMode(visibilityMode),
    departureTimes: normalizedDepartureTimes,
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
  const { name, number, trackerId, operatingHours, departureTimes, visibilityMode } = req.body;
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

  // Normalize departureTimes if provided (PUT with undefined means leave unchanged)
  let newDepartureTimes = buses[busIndex].departureTimes;
  if (departureTimes !== undefined) {
    const normalized = normalizeDepartureTimesInput(departureTimes);
    if (!Array.isArray(normalized) || normalized.length === 0) {
      return res.status(400).json({ error: 'departureTimes must include at least one valid HH:MM time' });
    }
    newDepartureTimes = normalized;
  }

  let newVisibilityMode = buses[busIndex].visibilityMode;
  if (visibilityMode !== undefined) {
    newVisibilityMode = normalizeBusVisibilityMode(visibilityMode);
  }

  buses[busIndex] = {
    ...buses[busIndex],
    name: name || buses[busIndex].name,
    number: number || buses[busIndex].number,
    trackerId: trackerId || buses[busIndex].trackerId,
    visibilityMode: newVisibilityMode,
    departureTimes: newDepartureTimes,
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
      busNumber: bus ? bus.number : null,
      busVisibilityMode: bus ? normalizeBusVisibilityMode(bus.visibilityMode) : null,
      source: loc && loc.source ? loc.source : null,
      sourceRef: loc && loc.sourceRef ? loc.sourceRef : null,
      deviceTimestamp: loc && Number.isFinite(Number(loc.deviceTimestamp)) ? Number(loc.deviceTimestamp) : null,
      receivedAt: loc && Number.isFinite(Number(loc.receivedAt)) ? Number(loc.receivedAt) : null
    });
  });

  res.json(trackers);
});

// Admin-only ingestion telemetry for migration monitoring
app.get('/api/admin/ingestion', basicAuth, (req, res) => {
  const trackersBySource = {
    http: [],
    mqtt: [],
    unknown: []
  };

  Object.keys(busLocations).forEach(trackerId => {
    const loc = busLocations[trackerId] || {};
    const source = loc.source === 'mqtt' ? 'mqtt' : (loc.source === 'http' ? 'http' : 'unknown');
    trackersBySource[source].push({
      trackerId,
      source,
      sourceRef: loc.sourceRef || null,
      timestamp: loc.timestamp || null,
      deviceTimestamp: loc.deviceTimestamp || null,
      lat: Number.isFinite(Number(loc.lat)) ? Number(loc.lat) : null,
      lon: Number.isFinite(Number(loc.lon)) ? Number(loc.lon) : null
    });
  });

  res.json({
    mqtt: {
      ...mqttState
    },
    trackersBySource,
    totals: {
      allTrackers: Object.keys(busLocations).length,
      http: trackersBySource.http.length,
      mqtt: trackersBySource.mqtt.length,
      unknown: trackersBySource.unknown.length
    }
  });
});

// Admin-only progression diagnostics for debugging next-stop selection.
app.get('/api/admin/progression', basicAuth, (req, res) => {
  const requestedBusId = req.query.busId ? String(req.query.busId) : null;
  const requestedTrackerId = req.query.trackerId ? String(req.query.trackerId) : null;

  const candidateBusIds = requestedBusId
    ? [requestedBusId]
    : buses.map(bus => bus.id);

  const diagnostics = [];

  for (const busId of candidateBusIds) {
    const bus = buses.find(item => item.id === busId);
    if (!bus) continue;

    const trackerId = Object.keys(busAssignments).find(tid => busAssignments[tid] === busId) || bus.trackerId || null;
    if (requestedTrackerId && trackerId !== requestedTrackerId) continue;

    const routeId = busRouteAssignments[busId] || null;
    const route = routeId ? routes.find(r => r.id === routeId) : null;
    const routeStops = routeId
      ? stops.filter(s => s.routeId === routeId).sort((a, b) => a.order - b.order)
      : [];
    const rawState = busNextStopState[busId] || null;
    const state = resolveLegacyProgressionState(rawState);

    const nextStop = state && state.nextStopId
      ? routeStops.find(s => s.id === state.nextStopId) || null
      : null;
    const lastStop = state && state.lastStopId
      ? routeStops.find(s => s.id === state.lastStopId) || null
      : null;

    const location = trackerId && busLocations[trackerId] ? busLocations[trackerId] : null;
    const lastSample = state && Array.isArray(state.lastSamples) && state.lastSamples.length > 0
      ? state.lastSamples[state.lastSamples.length - 1]
      : null;

    diagnostics.push({
      busId,
      busName: bus.name || null,
      busNumber: bus.number || null,
      trackerId,
      routeId,
      routeName: route ? route.name : null,
      hasManualOverride: Boolean(manualNextStops[busId]),
      manualNextStopId: manualNextStops[busId] || null,
      location: location
        ? {
            lat: Number.isFinite(Number(location.lat)) ? Number(location.lat) : null,
            lon: Number.isFinite(Number(location.lon)) ? Number(location.lon) : null,
            speedKmh: Number.isFinite(Number(location.velocity)) ? Number(location.velocity) : 0,
            source: location.source || null,
            timestamp: location.timestamp || null,
            deviceTimestamp: location.deviceTimestamp || null
          }
        : null,
      progression: {
        state: state ? state.state : null,
        confidence: state ? state.confidence : null,
        mismatchCount: state ? state.mismatchCount : null,
        routeProgressS: state ? state.routeProgressS : null,
        lap: state ? state.lap : null,
        updatedAt: state && state.updatedAt ? new Date(state.updatedAt).toISOString() : null,
        lastTransitionAt: state && state.lastTransitionAt ? new Date(state.lastTransitionAt).toISOString() : null,
        nextStop: nextStop
          ? { id: nextStop.id, name: nextStop.name, order: nextStop.order }
          : null,
        lastStop: lastStop
          ? { id: lastStop.id, name: lastStop.name, order: lastStop.order }
          : null
      },
      recentDecisionEvidence: {
        sampleCount: state && Array.isArray(state.lastSamples) ? state.lastSamples.length : 0,
        latest: lastSample || null,
        recent: state && Array.isArray(state.lastSamples)
          ? state.lastSamples.slice(-5)
          : []
      }
    });
  }

  res.json({
    generatedAt: new Date().toISOString(),
    filters: {
      busId: requestedBusId,
      trackerId: requestedTrackerId
    },
    count: diagnostics.length,
    diagnostics
  });
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

  const bus = buses.find(b => b.id === busId) || null;
  if (!bus) {
    return res.status(404).json({ error: 'Assigned bus not found' });
  }

  const routeId = busRouteAssignments[busId];
  if (!routeId) {
    return res.status(404).json({ error: 'Bus not assigned to any route' });
  }

  const route = routes.find(r => r.id === routeId) || null;

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

  const firstStop = getRouteStartStop(routeStops, route);

  // If no manual override, maintain a monotonic next-stop progression per bus.
  if (!nextStop) {
    let targetStop = null;
    const nowMs = Date.now();
    const routeLoop = isRouteLoop(route, routeStops);

    // Get the last known next stop state for this bus.
    // Backward-compatible with previous string-only state format.
    const lastState = resolveLegacyProgressionState(busNextStopState[busId]);

    const routeProgress = resolveRouteProgress(route, routeStops, busLocation, lastState, speedKmh);
    const nearestInfo = findNearestStop(routeStops, busLocation);
    const nearestImpliedNext = getImpliedNextFromNearest(routeStops, route, nearestInfo, speedKmh);
    const routeImplied = getImpliedStopsFromRouteProgress(routeStops, route, routeProgress, lastState, speedKmh);
    const impliedNext = routeImplied.impliedNextStop
      ? { stop: routeImplied.impliedNextStop, index: routeImplied.impliedNextIndex, source: routeImplied.source }
      : { stop: nearestImpliedNext.stop, index: nearestImpliedNext.index, source: 'nearest' };

    const lastNextStopId = lastState && lastState.nextStopId;
    const lastUpdatedAt = lastState ? lastState.updatedAt : 0;
    const lastTransitionAt = lastState ? (lastState.lastTransitionAt || lastUpdatedAt || 0) : 0;
    let mismatchCount = lastState ? (lastState.mismatchCount || 0) : 0;
    let confidence = lastState ? (lastState.confidence || 0.5) : 0.5;
    let progressionState = lastState ? (lastState.state || PROGRESSION_STATE.EN_ROUTE) : PROGRESSION_STATE.INITIALIZING;
    let didResync = false;
    const previousSamples = lastState ? lastState.lastSamples : [];
    const headingInfo = getDerivedHeadingFromSamples(previousSamples, busLocation.lat, busLocation.lon);
    const headingDelta = getAngularDifferenceDegrees(headingInfo.headingDeg, routeProgress.routeHeadingDeg);
    const reverseByHeading = headingDelta != null && headingDelta >= REVERSE_HEADING_DELTA_DEGREES;
    const reverseByProgress = Number.isFinite(routeProgress.busUnwrappedS)
      && Number.isFinite(lastState && lastState.routeProgressS)
      && Number.isFinite(routeProgress.totalLength)
      && (() => {
        const prevUnwrapped = ((lastState.lap || 0) * routeProgress.totalLength) + lastState.routeProgressS;
        return prevUnwrapped - routeProgress.busUnwrappedS > MIN_PROGRESS_DELTA_FOR_REVERSE_METERS;
      })();
    const isReverseTravel = routeProgress.available && (reverseByHeading || reverseByProgress);
    const lastNextStop = routeStops.find(s => s.id === lastNextStopId);
 
    if (lastNextStop) {
      // If we have a valid last-known stop, check if we've arrived.
      const distanceToLast = calculateDistance(busLocation.lat, busLocation.lon, lastNextStop.lat, lastNextStop.lon);
      const currentIndex = routeStops.findIndex(s => s.id === lastNextStop.id);
      const nextIndex = getNextStopIndex(routeStops, currentIndex, route);
      const forwardStop = routeStops[nextIndex];
      const distanceToForward = calculateDistance(busLocation.lat, busLocation.lon, forwardStop.lat, forwardStop.lon);
      const isForwardClearlyCloser = distanceToForward + FORWARD_ADVANCE_MARGIN_METERS < distanceToLast;
      const longEnoughSinceLastAdvance = nowMs - lastTransitionAt >= MIN_AUTO_ADVANCE_INTERVAL_MS;
 
      const currentStopS = routeProgress.stopSByStopId && Number.isFinite(routeProgress.stopSByStopId[lastNextStop.id])
        ? routeProgress.stopSByStopId[lastNextStop.id]
        : null;
      const nearestUnwrappedStopS = getNearestUnwrappedStopS(
        currentStopS,
        routeProgress.busUnwrappedS,
        routeProgress.totalLength,
        routeLoop
      );
      const hasPassEvidence = Number.isFinite(routeProgress.busUnwrappedS)
        && Number.isFinite(nearestUnwrappedStopS)
        && routeProgress.busUnwrappedS > (nearestUnwrappedStopS + PASS_MARGIN_METERS);

      if (distanceToLast <= ARRIVAL_RADIUS_METERS) {
        // We've arrived. Advance to the next stop in the sequence.
        targetStop = forwardStop;
      } else if (
        speedKmh >= STOPPED_SPEED_KMH_THRESHOLD &&
        longEnoughSinceLastAdvance &&
        isForwardClearlyCloser &&
        !isReverseTravel
      ) {
        // If the forward stop is significantly closer (and enough time has passed),
        // assume the tracked stop has been passed without stopping.
        targetStop = forwardStop;
      } else if (longEnoughSinceLastAdvance && hasPassEvidence && !isReverseTravel) {
        // Polyline progress says we have already moved beyond the target stop.
        targetStop = forwardStop;
      } else {
        // Still on the way to the last-known stop.
        targetStop = lastNextStop;
      }

      const impliedIndex = impliedNext.index;
      const lastIndex = routeStops.findIndex(s => s.id === lastNextStop.id);
      const mismatchGap = getIndexGap(lastIndex, impliedIndex, routeLoop, routeStops.length);
      if (Number.isFinite(mismatchGap) && mismatchGap >= MISMATCH_RESYNC_INDEX_GAP) {
        mismatchCount += 1;
        confidence = clamp(confidence - 0.12, 0, 1);
      } else {
        mismatchCount = Math.max(0, mismatchCount - 1);
        confidence = clamp(confidence + 0.05, 0, 1);
      }

      const canResync = nowMs - lastTransitionAt >= MIN_RESYNC_INTERVAL_MS;
      if (
        canResync &&
        impliedNext.stop &&
        mismatchCount >= MISMATCH_RESYNC_SAMPLE_COUNT
      ) {
        targetStop = impliedNext.stop;
        mismatchCount = 0;
        confidence = clamp(confidence + 0.08, 0, 1);
        progressionState = PROGRESSION_STATE.OFF_ROUTE_RECOVERY;
        didResync = true;
      }
    } else {
      // No state, so initialize from route-progress implication when available,
      // otherwise use the geographically nearest stop.
      const nearestStop = nearestInfo.stop;
      const initializedFromRoute = routeImplied.impliedNextStop;

      // If a nearest stop was found, use it. Otherwise, default to the first stop of the route.
      // This prevents errors if all distance calculations failed.
      targetStop = initializedFromRoute || nearestStop || routeStops[0];
      mismatchCount = 0;
      confidence = clamp(confidence + 0.08, 0, 1);
    }

    if (routeProgress.available) {
      confidence = clamp((confidence * 0.7) + (routeProgress.projectionConfidence * 0.3), 0, 1);
    }

    if (isReverseTravel) {
      confidence = clamp(confidence - 0.08, 0, 1);
      if (progressionState !== PROGRESSION_STATE.OFF_ROUTE_RECOVERY) {
        progressionState = PROGRESSION_STATE.OFF_ROUTE_RECOVERY;
      }
    }
 
    // Check for arrival at the *newly determined* target stop, in case the bus is sitting on top of it.
    let distanceToTarget = calculateDistance(
      busLocation.lat,
      busLocation.lon,
      targetStop.lat,
      targetStop.lon
    );

    const preTransitionSample = {
      t: nowMs,
      lat: busLocation.lat,
      lon: busLocation.lon,
      speedKmh: Number.isFinite(speedKmh) ? Number(speedKmh.toFixed(2)) : 0,
      selectedNextStopId: targetStop.id,
      distanceToTarget: Number.isFinite(distanceToTarget) ? Number(distanceToTarget.toFixed(1)) : null
    };
    const dwell = getDwellConfirmation(previousSamples, preTransitionSample, targetStop.id);

    if (distanceToTarget <= ARRIVAL_RADIUS_METERS && speedKmh < STOPPED_SPEED_KMH_THRESHOLD && dwell.confirmed) {
      const currentIndex = routeStops.findIndex(s => s.id === targetStop.id);
      const nextIndex = getNextStopIndex(routeStops, currentIndex, route);
      targetStop = routeStops[nextIndex];
      distanceToTarget = calculateDistance(
        busLocation.lat,
        busLocation.lon,
        targetStop.lat,
        targetStop.lon
      );
    }

    const previousTargetId = lastNextStopId || null;
    const didTransition = !previousTargetId || previousTargetId !== targetStop.id;
    const nextTransitionAt = didTransition ? nowMs : lastTransitionAt;
    if (!didResync) {
      if (progressionState !== PROGRESSION_STATE.OFF_ROUTE_RECOVERY || confidence >= 0.55) {
        progressionState = dwell.confirmed
          ? PROGRESSION_STATE.DWELL_AT_STOP
          : PROGRESSION_STATE.EN_ROUTE;
      }
    }

    const sample = {
      t: nowMs,
      lat: busLocation.lat,
      lon: busLocation.lon,
      speedKmh: Number.isFinite(speedKmh) ? Number(speedKmh.toFixed(2)) : 0,
      headingDeg: Number.isFinite(headingInfo.headingDeg) ? Number(headingInfo.headingDeg.toFixed(1)) : null,
      routeHeadingDeg: Number.isFinite(routeProgress.routeHeadingDeg) ? Number(routeProgress.routeHeadingDeg.toFixed(1)) : null,
      reverseTravel: isReverseTravel,
      impliedNextStopId: impliedNext.stop ? impliedNext.stop.id : null,
      impliedBy: impliedNext.source,
      selectedNextStopId: targetStop.id,
      distanceToTarget: Number.isFinite(distanceToTarget) ? Number(distanceToTarget.toFixed(1)) : null,
      dwellConsecutiveSamples: dwell.consecutive,
      dwellSeconds: Number(dwell.dwellSeconds.toFixed(1)),
      routeProgressS: Number.isFinite(routeImplied.routeProgressS) ? Number(routeImplied.routeProgressS.toFixed(1)) : null,
      lap: Number.isFinite(routeImplied.lap) ? routeImplied.lap : 0,
      distanceToRoute: Number.isFinite(routeImplied.projectionDistance) ? Number(routeImplied.projectionDistance.toFixed(1)) : null,
      mismatchCount,
      confidence: Number(confidence.toFixed(3))
    };

    busNextStopState[busId] = {
      nextStopId: targetStop.id,
      lastDistanceToStop: Math.round(distanceToTarget),
      updatedAt: nowMs,
      lastTransitionAt: nextTransitionAt,
      mismatchCount,
      confidence: Number(confidence.toFixed(3)),
      state: progressionState,
      routeProgressS: Number.isFinite(routeImplied.routeProgressS) ? Number(routeImplied.routeProgressS.toFixed(1)) : null,
      lap: Number.isFinite(routeImplied.lap) ? routeImplied.lap : (lastState ? (lastState.lap || 0) : 0),
      lastStopId: routeImplied.impliedLastStop ? routeImplied.impliedLastStop.id : currentStopFromNext(routeStops, targetStop.id, route),
      lastSamples: pushProgressionSample(lastState ? lastState.lastSamples : [], sample)
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
    ? getPreviousStopIndex(routeStops, nextStopIndex, route)
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

  let serviceState = SERVICE_STATE.EN_ROUTE;
  let nextRun = null;
  const progressionSnapshot = resolveLegacyProgressionState(busNextStopState[busId]);

  // Timetable-based "waiting at start" detection only applies when there is
  // no manual override in effect.
  const departureTimesMinutes = getDepartureMinutesForBus(bus);
  if (!isManualOverride && departureTimesMinutes.length > 0) {
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
    const nowMinutes = getMinutesInTimeZone(now, SERVICE_TIME_ZONE);
    const nowSeconds = getSecondsSinceMidnightInTimeZone(now, SERVICE_TIME_ZONE);
    let nextDepartureMinutes = null;
    for (const dep of departureTimesMinutes) {
      if (dep > nowMinutes) {
        nextDepartureMinutes = dep;
        break;
      }
    }

    if (nextDepartureMinutes !== null) {
      const secondsUntil = Math.max(0, (nextDepartureMinutes * 60) - nowSeconds);

      // Only switch to "waiting" mode if the bus is effectively parked at the
      // start stop and there is an upcoming departure.
      if (isNearStart && isStopped) {
        serviceState = SERVICE_STATE.WAITING;
        eta = null; // we use nextRun.secondsUntil on the client instead
        nextRun = {
          time: minutesToHHMM(nextDepartureMinutes),
          departureMinutes: nextDepartureMinutes,
          secondsUntil,
          timeZone: SERVICE_TIME_ZONE
        };
        if (progressionSnapshot) {
          progressionSnapshot.state = PROGRESSION_STATE.WAITING_START;
          if (busNextStopState[busId] && typeof busNextStopState[busId] === 'object') {
            busNextStopState[busId].state = PROGRESSION_STATE.WAITING_START;
          }
        }
      }
    } else {
      // No more departures today
      if (isNearStart && isStopped) {
        serviceState = SERVICE_STATE.FINISHED;
      }
    }
  }

  const serviceStateLabel = getServiceStateLabel(serviceState);

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
    serviceStateLabel,
    nextRun,
    routeProgression: {
      startStopId: route && route.startStopId ? route.startStopId : null,
      endStopId: route && route.endStopId ? route.endStopId : null,
      isLoop: isRouteLoop(route, routeStops),
      machineStates: Object.values(PROGRESSION_STATE),
      routeProgressS: progressionSnapshot && Number.isFinite(progressionSnapshot.routeProgressS)
        ? progressionSnapshot.routeProgressS
        : null,
      lap: progressionSnapshot ? (progressionSnapshot.lap || 0) : 0,
      progressionState: progressionSnapshot ? progressionSnapshot.state : null,
      progressionConfidence: progressionSnapshot ? progressionSnapshot.confidence : null,
      mismatchCount: progressionSnapshot ? progressionSnapshot.mismatchCount : null
    }
  });
});

function isRouteLoop(route, routeStops) {
  if (!routeStops || routeStops.length < 2) return true;
  if (route && typeof route.isLoop === 'boolean') return route.isLoop;
  if (route && route.startStopId && route.endStopId && route.startStopId !== route.endStopId) {
    return false;
  }
  return true;
}

function getNextStopIndex(routeStops, currentIndex, route) {
  if (currentIndex < 0 || currentIndex >= routeStops.length) return 0;

  const loop = isRouteLoop(route, routeStops);
  if (loop) {
    return (currentIndex + 1) % routeStops.length;
  }

  const configuredEndIndex = route && route.endStopId
    ? routeStops.findIndex(s => s.id === route.endStopId)
    : -1;
  const terminalIndex = configuredEndIndex >= 0 ? configuredEndIndex : routeStops.length - 1;

  if (currentIndex >= terminalIndex) return terminalIndex;
  return currentIndex + 1;
}

function getPreviousStopIndex(routeStops, currentIndex, route) {
  if (currentIndex < 0 || currentIndex >= routeStops.length) return -1;

  const loop = isRouteLoop(route, routeStops);
  if (loop) {
    return (currentIndex - 1 + routeStops.length) % routeStops.length;
  }

  const configuredStartIndex = route && route.startStopId
    ? routeStops.findIndex(s => s.id === route.startStopId)
    : -1;
  const terminalStartIndex = configuredStartIndex >= 0 ? configuredStartIndex : 0;

  if (currentIndex <= terminalStartIndex) return terminalStartIndex;
  return currentIndex - 1;
}

function getRouteStartStop(routeStops, route) {
  if (!routeStops || routeStops.length === 0) return null;
  if (route && route.startStopId) {
    const configuredStart = routeStops.find(s => s.id === route.startStopId);
    if (configuredStart) return configuredStart;
  }
  return routeStops[0];
}

function currentStopFromNext(routeStops, nextStopId, route) {
  const nextIndex = routeStops.findIndex(s => s.id === nextStopId);
  if (nextIndex < 0) return null;
  const previousIndex = getPreviousStopIndex(routeStops, nextIndex, route);
  if (previousIndex < 0 || previousIndex >= routeStops.length) return null;
  return routeStops[previousIndex].id;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getIndexGap(indexA, indexB, loop, length) {
  if (indexA < 0 || indexB < 0 || length <= 0) return Infinity;
  const direct = Math.abs(indexA - indexB);
  if (!loop) return direct;
  return Math.min(direct, length - direct);
}

function pushProgressionSample(lastSamples, sample) {
  const samples = Array.isArray(lastSamples) ? lastSamples.slice(-PROGRESSION_SAMPLE_BUFFER_SIZE + 1) : [];
  samples.push(sample);
  return samples;
}

function resolveLegacyProgressionState(rawState) {
  if (!rawState) return null;
  if (typeof rawState === 'string') {
    return {
      nextStopId: rawState,
      lastDistanceToStop: null,
      updatedAt: 0,
      lastTransitionAt: 0,
      mismatchCount: 0,
      confidence: 0.5,
      state: PROGRESSION_STATE.INITIALIZING,
      routeProgressS: null,
      lap: 0,
      lastStopId: null,
      lastSamples: []
    };
  }
  if (typeof rawState !== 'object') return null;

  return {
    nextStopId: rawState.nextStopId || null,
    lastDistanceToStop: Number.isFinite(rawState.lastDistanceToStop) ? rawState.lastDistanceToStop : null,
    updatedAt: Number.isFinite(rawState.updatedAt) ? rawState.updatedAt : 0,
    lastTransitionAt: Number.isFinite(rawState.lastTransitionAt)
      ? rawState.lastTransitionAt
      : (Number.isFinite(rawState.updatedAt) ? rawState.updatedAt : 0),
    mismatchCount: Number.isFinite(rawState.mismatchCount) ? rawState.mismatchCount : 0,
    confidence: Number.isFinite(rawState.confidence) ? clamp(rawState.confidence, 0, 1) : 0.5,
    state: typeof rawState.state === 'string' ? rawState.state : PROGRESSION_STATE.INITIALIZING,
    routeProgressS: Number.isFinite(rawState.routeProgressS) ? rawState.routeProgressS : null,
    lap: Number.isFinite(rawState.lap) ? rawState.lap : 0,
    lastStopId: rawState.lastStopId || null,
    lastSamples: Array.isArray(rawState.lastSamples) ? rawState.lastSamples.slice(-PROGRESSION_SAMPLE_BUFFER_SIZE) : []
  };
}

function isValidCoordinatePair(point) {
  return Array.isArray(point)
    && point.length >= 2
    && Number.isFinite(point[0])
    && Number.isFinite(point[1]);
}

function getRouteGeometryPoints(route) {
  if (!route || !Array.isArray(route.coordinates)) return [];
  return route.coordinates.filter(isValidCoordinatePair);
}

function toLocalXYMeters(lat, lon, originLat, originLon) {
  const latScale = 111320;
  const lonScale = 111320 * Math.cos(originLat * Math.PI / 180);
  return {
    x: (lon - originLon) * lonScale,
    y: (lat - originLat) * latScale
  };
}

function buildRouteProgressContext(route, routeStops) {
  const geometry = getRouteGeometryPoints(route);
  if (geometry.length < 2 || !Array.isArray(routeStops) || routeStops.length === 0) {
    return null;
  }

  const originLat = geometry[0][0];
  const originLon = geometry[0][1];
  const xyPoints = geometry.map(point => toLocalXYMeters(point[0], point[1], originLat, originLon));
  const cumulativeLengths = [0];
  for (let i = 1; i < xyPoints.length; i += 1) {
    const dx = xyPoints[i].x - xyPoints[i - 1].x;
    const dy = xyPoints[i].y - xyPoints[i - 1].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    cumulativeLengths.push(cumulativeLengths[i - 1] + segLen);
  }
  const totalLength = cumulativeLengths[cumulativeLengths.length - 1];
  if (!Number.isFinite(totalLength) || totalLength <= 0) {
    return null;
  }

  const context = {
    originLat,
    originLon,
    geometry,
    xyPoints,
    cumulativeLengths,
    totalLength
  };

  const stopProgress = [];
  for (const stop of routeStops) {
    const projection = projectPointToRouteS(context, stop.lat, stop.lon);
    if (!projection || !Number.isFinite(projection.s)) continue;
    stopProgress.push({ stop, s: projection.s });
  }

  if (stopProgress.length === 0) return null;
  stopProgress.sort((a, b) => a.s - b.s);
  context.stopProgress = stopProgress;
  context.stopSByStopId = stopProgress.reduce((acc, entry) => {
    acc[entry.stop.id] = entry.s;
    return acc;
  }, {});
  return context;
}

function projectPointToRouteS(context, lat, lon) {
  if (!context || !Array.isArray(context.xyPoints) || context.xyPoints.length < 2) return null;
  const point = toLocalXYMeters(lat, lon, context.originLat, context.originLon);

  let best = null;
  for (let i = 0; i < context.xyPoints.length - 1; i += 1) {
    const a = context.xyPoints[i];
    const b = context.xyPoints[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = point.x - a.x;
    const apy = point.y - a.y;
    const denom = (abx * abx) + (aby * aby);
    const rawT = denom > 0 ? ((apx * abx) + (apy * aby)) / denom : 0;
    const t = clamp(rawT, 0, 1);
    const cx = a.x + (abx * t);
    const cy = a.y + (aby * t);
    const dx = point.x - cx;
    const dy = point.y - cy;
    const distSq = (dx * dx) + (dy * dy);
    const segmentLength = context.cumulativeLengths[i + 1] - context.cumulativeLengths[i];
    const s = context.cumulativeLengths[i] + (segmentLength * t);

    if (!best || distSq < best.distSq) {
      best = {
        s,
        t,
        segmentIndex: i,
        distanceToRoute: Math.sqrt(distSq)
      };
    }
  }

  return best;
}

function getImpliedStopsFromRouteProgress(routeStops, route, routeProgress, lastState, speedKmh) {
  if (!routeProgress || !routeProgress.available || !routeProgress.nextStop) {
    return {
      impliedNextStop: null,
      impliedNextIndex: -1,
      impliedLastStop: null,
      impliedLastIndex: -1,
      routeProgressS: null,
      lap: lastState ? (lastState.lap || 0) : 0,
      source: 'nearest',
      projectionDistance: null,
      projectionConfidence: 0
    };
  }

  const impliedNextStop = routeProgress.nextStop;
  const impliedLastStop = routeProgress.lastStop;
  const impliedNextIndex = routeStops.findIndex(s => s.id === impliedNextStop.id);
  const impliedLastIndex = impliedLastStop ? routeStops.findIndex(s => s.id === impliedLastStop.id) : -1;

  // If the bus is effectively stopped and exactly at the implied next stop, bias to the following stop.
  if (
    impliedNextIndex >= 0 &&
    speedKmh < STOPPED_SPEED_KMH_THRESHOLD &&
    routeProgress.distanceToRoute <= ARRIVAL_RADIUS_METERS
  ) {
    const forwardIndex = getNextStopIndex(routeStops, impliedNextIndex, route);
    return {
      impliedNextStop: routeStops[forwardIndex],
      impliedNextIndex: forwardIndex,
      impliedLastStop: impliedNextStop,
      impliedLastIndex: impliedNextIndex,
      routeProgressS: routeProgress.routeProgressS,
      lap: routeProgress.lap,
      source: 'route_s',
      projectionDistance: routeProgress.distanceToRoute,
      projectionConfidence: routeProgress.projectionConfidence
    };
  }

  return {
    impliedNextStop,
    impliedNextIndex,
    impliedLastStop,
    impliedLastIndex,
    routeProgressS: routeProgress.routeProgressS,
    lap: routeProgress.lap,
    source: 'route_s',
    projectionDistance: routeProgress.distanceToRoute,
    projectionConfidence: routeProgress.projectionConfidence
  };
}

function resolveRouteProgress(route, routeStops, busLocation, lastState, speedKmh) {
  const context = buildRouteProgressContext(route, routeStops);
  if (!context) {
    return {
      available: false,
      routeProgressS: null,
      lap: lastState ? (lastState.lap || 0) : 0,
      busUnwrappedS: null,
      totalLength: null,
      distanceToRoute: null,
      projectionConfidence: 0,
      routeHeadingDeg: null,
      stopSByStopId: {},
      lastStop: null,
      nextStop: null
    };
  }

  const projection = projectPointToRouteS(context, busLocation.lat, busLocation.lon);
  if (!projection || !Number.isFinite(projection.s) || !Number.isFinite(projection.distanceToRoute)) {
    return {
      available: false,
      routeProgressS: null,
      lap: lastState ? (lastState.lap || 0) : 0,
      busUnwrappedS: null,
      totalLength: context.totalLength,
      distanceToRoute: null,
      projectionConfidence: 0,
      routeHeadingDeg: null,
      stopSByStopId: context.stopSByStopId || {},
      lastStop: null,
      nextStop: null
    };
  }

  const wrappedS = clamp(projection.s, 0, context.totalLength);
  const loop = isRouteLoop(route, routeStops);
  let lap = lastState ? (lastState.lap || 0) : 0;
  const lastWrappedS = lastState && Number.isFinite(lastState.routeProgressS) ? lastState.routeProgressS : null;

  if (loop && lastWrappedS != null && speedKmh >= STOPPED_SPEED_KMH_THRESHOLD) {
    const nearEndThreshold = context.totalLength * 0.85;
    const nearStartThreshold = context.totalLength * 0.15;
    if (lastWrappedS >= nearEndThreshold && wrappedS <= nearStartThreshold) {
      lap += 1;
    } else if (lastWrappedS <= nearStartThreshold && wrappedS >= nearEndThreshold) {
      lap = Math.max(0, lap - 1);
    }
  }

  const projectionConfidence = clamp(1 - (projection.distanceToRoute / PROJECTION_MAX_DISTANCE_METERS), 0, 1);
  const projectionIsUsable = projection.distanceToRoute <= PROJECTION_MAX_DISTANCE_METERS;
  const routeHeadingDeg = (() => {
    const a = context.geometry[projection.segmentIndex];
    const b = context.geometry[projection.segmentIndex + 1];
    if (!a || !b) return null;
    return getBearingDegrees(a[0], a[1], b[0], b[1]);
  })();

  const stopCandidates = [];
  const lapOffsets = loop ? [-1, 0, 1] : [0];
  for (const stopItem of context.stopProgress) {
    for (const offset of lapOffsets) {
      stopCandidates.push({
        stop: stopItem.stop,
        sWrapped: stopItem.s,
        sUnwrapped: (lap + offset) * context.totalLength + stopItem.s
      });
    }
  }

  const busUnwrappedS = (lap * context.totalLength) + wrappedS;
  let lastCandidate = null;
  let nextCandidate = null;

  for (const candidate of stopCandidates) {
    if (candidate.sUnwrapped <= busUnwrappedS) {
      if (!lastCandidate || candidate.sUnwrapped > lastCandidate.sUnwrapped) {
        lastCandidate = candidate;
      }
    }
    if (candidate.sUnwrapped > busUnwrappedS) {
      if (!nextCandidate || candidate.sUnwrapped < nextCandidate.sUnwrapped) {
        nextCandidate = candidate;
      }
    }
  }

  if (!lastCandidate && context.stopProgress.length > 0) {
    const fallback = context.stopProgress[0];
    lastCandidate = {
      stop: fallback.stop,
      sWrapped: fallback.s,
      sUnwrapped: loop ? (lap - 1) * context.totalLength + fallback.s : fallback.s
    };
  }

  if (!nextCandidate && context.stopProgress.length > 0) {
    const fallback = context.stopProgress[context.stopProgress.length - 1];
    nextCandidate = {
      stop: fallback.stop,
      sWrapped: fallback.s,
      sUnwrapped: loop ? (lap + 1) * context.totalLength + fallback.s : fallback.s
    };
  }

  return {
    available: projectionIsUsable,
    routeProgressS: wrappedS,
    lap,
    busUnwrappedS,
    totalLength: context.totalLength,
    distanceToRoute: projection.distanceToRoute,
    projectionConfidence,
    routeHeadingDeg,
    stopSByStopId: context.stopSByStopId || {},
    lastStop: lastCandidate ? lastCandidate.stop : null,
    nextStop: nextCandidate ? nextCandidate.stop : null
  };
}

function findNearestStop(routeStops, busLocation) {
  let nearestStop = null;
  let nearestIndex = -1;
  let minDistance = Infinity;

  for (let i = 0; i < routeStops.length; i += 1) {
    const stop = routeStops[i];
    const dist = calculateDistance(busLocation.lat, busLocation.lon, stop.lat, stop.lon);
    if (!Number.isFinite(dist)) continue;
    if (dist < minDistance) {
      minDistance = dist;
      nearestStop = stop;
      nearestIndex = i;
    }
  }

  return {
    stop: nearestStop,
    index: nearestIndex,
    distance: minDistance
  };
}

function getImpliedNextFromNearest(routeStops, route, nearestInfo, speedKmh) {
  if (!nearestInfo || nearestInfo.index < 0) {
    return { stop: null, index: -1 };
  }

  const nearestStop = routeStops[nearestInfo.index];
  if (!nearestStop) {
    return { stop: null, index: -1 };
  }

  const isMoving = speedKmh >= STOPPED_SPEED_KMH_THRESHOLD;
  const isNearNearest = nearestInfo.distance <= ARRIVAL_RADIUS_METERS;
  if (isMoving && isNearNearest) {
    const forwardIndex = getNextStopIndex(routeStops, nearestInfo.index, route);
    return { stop: routeStops[forwardIndex], index: forwardIndex };
  }

  return { stop: nearestStop, index: nearestInfo.index };
}

function getBearingDegrees(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const lambda1 = lon1 * Math.PI / 180;
  const lambda2 = lon2 * Math.PI / 180;
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x = (Math.cos(phi1) * Math.sin(phi2))
    - (Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1));
  const theta = Math.atan2(y, x) * 180 / Math.PI;
  return (theta + 360) % 360;
}

function getAngularDifferenceDegrees(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function getDerivedHeadingFromSamples(lastSamples, currentLat, currentLon) {
  if (!Array.isArray(lastSamples) || lastSamples.length === 0) {
    return { headingDeg: null, movementMeters: 0 };
  }

  const recent = lastSamples[lastSamples.length - 1];
  if (!recent || !Number.isFinite(recent.lat) || !Number.isFinite(recent.lon)) {
    return { headingDeg: null, movementMeters: 0 };
  }

  const movementMeters = calculateDistance(recent.lat, recent.lon, currentLat, currentLon);
  if (!Number.isFinite(movementMeters) || movementMeters < 3) {
    return { headingDeg: null, movementMeters: movementMeters || 0 };
  }

  return {
    headingDeg: getBearingDegrees(recent.lat, recent.lon, currentLat, currentLon),
    movementMeters
  };
}

function getNearestUnwrappedStopS(stopWrappedS, busUnwrappedS, totalLength, loop) {
  if (!Number.isFinite(stopWrappedS) || !Number.isFinite(busUnwrappedS) || !Number.isFinite(totalLength) || totalLength <= 0) {
    return null;
  }
  if (!loop) return stopWrappedS;

  const baseLap = Math.floor(busUnwrappedS / totalLength);
  const candidates = [baseLap - 1, baseLap, baseLap + 1].map(lap => (lap * totalLength) + stopWrappedS);
  let best = null;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate)) continue;
    if (best == null || Math.abs(candidate - busUnwrappedS) < Math.abs(best - busUnwrappedS)) {
      best = candidate;
    }
  }
  return best;
}

function getDwellConfirmation(lastSamples, currentSample, targetStopId) {
  const candidates = [];
  if (Array.isArray(lastSamples)) {
    candidates.push(...lastSamples.slice(-PROGRESSION_SAMPLE_BUFFER_SIZE));
  }
  candidates.push(currentSample);

  let consecutive = 0;
  let firstTime = null;
  let lastTime = null;

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const sample = candidates[i];
    const isSameTarget = sample && sample.selectedNextStopId === targetStopId;
    const isNear = sample && Number.isFinite(sample.distanceToTarget)
      && sample.distanceToTarget <= ARRIVAL_RADIUS_METERS;
    const isSlow = sample && Number.isFinite(sample.speedKmh)
      && sample.speedKmh < STOPPED_SPEED_KMH_THRESHOLD;
    if (!(isSameTarget && isNear && isSlow)) break;

    consecutive += 1;
    if (lastTime == null) lastTime = sample.t;
    firstTime = sample.t;
  }

  const dwellSeconds = firstTime != null && lastTime != null
    ? Math.max(0, (lastTime - firstTime) / 1000)
    : 0;

  return {
    consecutive,
    dwellSeconds,
    confirmed: consecutive >= ARRIVAL_CONFIRMATION_SAMPLES && dwellSeconds >= MIN_DWELL_SECONDS
  };
}

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
  const referenceDate = nowDate || new Date();
  const currentMin = getMinutesInTimeZone(referenceDate, SERVICE_TIME_ZONE);

  if (startMin <= endMin) {
    return currentMin >= startMin && currentMin <= endMin;
  } else {
    // Overnight range (e.g., 22:00 - 04:00)
    return currentMin >= startMin || currentMin <= endMin;
  }
}

function getDateTimePartsInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  const out = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      out[part.type] = Number(part.value);
    }
  }
  return out;
}

function getMinutesInTimeZone(date, timeZone) {
  const parts = getDateTimePartsInTimeZone(date, timeZone);
  return (parts.hour || 0) * 60 + (parts.minute || 0);
}

function getSecondsSinceMidnightInTimeZone(date, timeZone) {
  const parts = getDateTimePartsInTimeZone(date, timeZone);
  return ((parts.hour || 0) * 60 * 60) + ((parts.minute || 0) * 60) + (parts.second || 0);
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
          googleMapsNavigateUrl: null,
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

    if (!isPublicBus(bus)) {
      return;
    }

    const routeId = busRouteAssignments[busId];
    if (!routeId) {
      return;
    }

    if (bus.operatingHours && !isWithinOperatingHours(bus.operatingHours)) {
      return; // not visible
    }

    visibleCount++;
  });

  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    buses: visibleCount,
    routes: routes.length,
    ingestion: {
      http: {
        enabled: true
      },
      mqtt: {
        enabled: mqttState.enabled,
        connected: mqttState.connected,
        topic: mqttState.topic,
        received: mqttState.received,
        accepted: mqttState.accepted,
        dropped: mqttState.dropped,
        parseErrors: mqttState.parseErrors,
        lastMessageAt: mqttState.lastMessageAt,
        lastError: mqttState.lastError
      }
    }
  });
});

// Admin panel (protected with basic auth)
app.get('/admin', basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

setupMqttIngestion();

app.listen(PORT, () => {
  console.log(`OpenTop Tracker server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

let isShuttingDown = false;

// Graceful shutdown prevents abrupt TLS EOFs on the broker side.
function shutdownGracefully(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  console.log(`\n${signal} received. Saving data before shutdown...`);

  const finalize = () => {
    saveData();
    console.log('Data saved. Goodbye!');
    process.exit(0);
  };

  if (!mqttClient) {
    finalize();
    return;
  }

  const forceExitTimer = setTimeout(() => {
    console.warn('⚠️ MQTT shutdown timed out; forcing process exit.');
    finalize();
  }, 5000);

  mqttClient.end(false, {}, () => {
    clearTimeout(forceExitTimer);
    finalize();
  });
}

process.on('SIGINT', () => shutdownGracefully('SIGINT'));
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));

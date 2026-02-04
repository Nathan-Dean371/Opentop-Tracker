# OpenTop Tracker - System Architecture

## Overview Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    OpenTop Tracker System                        │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐         ┌──────────────────┐
│  OwnTracks App   │         │   Web Browser    │
│  (Mobile GPS)    │         │   (Admin/User)   │
└────────┬─────────┘         └────────┬─────────┘
         │                            │
         │ POST /owntracks            │ GET /admin
         │ (Location Data)            │ GET /
         │                            │ GET /embed
         ▼                            ▼
┌─────────────────────────────────────────────────┐
│           Express.js Server (Node.js)            │
│  ┌───────────────────────────────────────────┐  │
│  │            API Endpoints                   │  │
│  │  • /owntracks (receive GPS data)          │  │
│  │  • /api/routes (CRUD)                     │  │
│  │  • /api/stops (CRUD)                      │  │
│  │  • /api/buses (CRUD)                      │  │
│  │  • /api/assignments (manage links)        │  │
│  │  • /api/eta/:trackerId (calculate)        │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │         In-Memory Data Storage             │  │
│  │  • busLocations = {}                      │  │
│  │  • routes = []                            │  │
│  │  • stops = []                             │  │
│  │  • buses = []                             │  │
│  │  • busAssignments = {}                    │  │
│  │  • busRouteAssignments = {}               │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │         Static File Serving                │  │
│  │  • index.html (Main Dashboard)            │  │
│  │  • admin.html (Admin Panel)               │  │
│  │  • embed.html (Embeddable View)           │  │
│  │  • Leaflet.js + OpenStreetMap             │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Data Flow

### 1. GPS Tracking Flow
```
OwnTracks App
     │
     │ {"_type": "location", "lat": 51.5, "lon": -0.1, ...}
     ▼
POST /owntracks
     │
     ▼
Server stores in busLocations[trackerId]
     │
     ▼
Clients poll GET /api/locations every 5s
     │
     ▼
Map updates bus marker positions
```

### 2. Route Creation Flow
```
Admin clicks on map
     │
     ▼
JavaScript captures coordinates
     │
     ▼
Form submission → POST /api/routes
     │
     ▼
Server stores in routes[]
     │
     ▼
Route appears on all maps
```

### 3. ETA Calculation Flow
```
Client requests GET /api/eta/AB
     │
     ▼
Server checks: busAssignments[AB] → busId
     │
     ▼
Server checks: busRouteAssignments[busId] → routeId
     │
     ▼
Server gets: busLocations[AB] → current position
     │
     ▼
Server filters: stops where routeId matches
     │
     ▼
Calculate distance to each stop (Haversine)
     │
     ▼
Find closest stop = next stop
     │
     ▼
Calculate: ETA = distance / current_speed
     │
     ▼
Return: {nextStop, distance, eta}
```

## Data Relationships

```
┌─────────────┐
│   Tracker   │
│   (TID)     │
└──────┬──────┘
       │
       │ busAssignments[TID] = busId
       │
       ▼
┌─────────────┐         ┌─────────────┐
│     Bus     │ ◄────── │  Location   │
│  (busId)    │         │   (GPS)     │
└──────┬──────┘         └─────────────┘
       │
       │ busRouteAssignments[busId] = routeId
       │
       ▼
┌─────────────┐
│    Route    │
│  (routeId)  │
└──────┬──────┘
       │
       │ stops[].routeId = routeId
       │
       ▼
┌─────────────┐
│    Stops    │
│  (ordered)  │
└─────────────┘
```

## Component Architecture

### Frontend Components

```
┌────────────────────────────────────────┐
│          index.html (Main View)         │
│  ┌──────────────────────────────────┐  │
│  │  Map Display                      │  │
│  │  • Leaflet.js instance            │  │
│  │  • Bus markers (real-time)        │  │
│  │  • Route polylines                │  │
│  │  • Stop markers                   │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │  Info Panel                       │  │
│  │  • Bus cards                      │  │
│  │  • Status indicators              │  │
│  │  • ETA display                    │  │
│  │  • Battery/Speed info             │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │  Auto-Update System               │  │
│  │  • setInterval(5000ms)            │  │
│  │  • Fetch locations                │  │
│  │  • Fetch ETAs                     │  │
│  │  • Update DOM                     │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│          admin.html (Admin Panel)       │
│  ┌──────────────────────────────────┐  │
│  │  Routes Tab                       │  │
│  │  • Map click handler              │  │
│  │  • Coordinate builder             │  │
│  │  • Route preview                  │  │
│  │  • CRUD forms                     │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │  Stops Tab                        │  │
│  │  • Map location picker            │  │
│  │  • Route selector                 │  │
│  │  • Order assignment               │  │
│  │  • CRUD forms                     │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │  Buses Tab                        │  │
│  │  • Registration form              │  │
│  │  • Tracker ID assignment          │  │
│  │  • CRUD operations                │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │  Assignments Tab                  │  │
│  │  • Bus selector                   │  │
│  │  • Route selector                 │  │
│  │  • Assignment viewer              │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│         embed.html (Embed View)         │
│  ┌──────────────────────────────────┐  │
│  │  Full-Screen Map                  │  │
│  │  • Minimal UI                     │  │
│  │  • All tracking features          │  │
│  │  • Auto-updates                   │  │
│  │  • Popup info                     │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

## API Request/Response Patterns

### Create Route
```
Request:
POST /api/routes
Content-Type: application/json

{
  "name": "City Tour",
  "coordinates": [[51.5, -0.1], [51.51, -0.11]],
  "color": "#FF5722"
}

Response:
{
  "id": "route-1706381176123",
  "name": "City Tour",
  "coordinates": [[51.5, -0.1], [51.51, -0.11]],
  "color": "#FF5722",
  "createdAt": "2026-02-03T10:00:00.000Z"
}
```

### Calculate ETA
```
Request:
GET /api/eta/AB

Response:
{
  "trackerId": "AB",
  "busId": "bus-1706381176124",
  "routeId": "route-1706381176123",
  "nextStop": {
    "id": "stop-1706381176125",
    "name": "City Hall",
    "lat": 51.505,
    "lon": -0.12,
    "routeId": "route-1706381176123",
    "order": 1,
    "distance": 250,
    "eta": 30
  },
  "currentSpeed": "30.0",
  "allStops": [...]
}
```

## State Management

### Server State
```javascript
// Current state in memory
{
  busLocations: {
    "AB": {lat: 51.5, lon: -0.1, timestamp: 1706381176, ...},
    "CD": {lat: 51.51, lon: -0.11, timestamp: 1706381180, ...}
  },
  routes: [
    {id: "route-123", name: "City Tour", coordinates: [...], ...}
  ],
  stops: [
    {id: "stop-456", name: "City Hall", routeId: "route-123", ...}
  ],
  buses: [
    {id: "bus-789", name: "Red Bus", number: "101", trackerId: "AB"}
  ],
  busAssignments: {
    "AB": "bus-789"
  },
  busRouteAssignments: {
    "bus-789": "route-123"
  }
}
```

### Client State (index.html)
```javascript
{
  map: LeafletMapInstance,
  busMarkers: {
    "AB": LeafletMarkerInstance
  },
  routeLayers: [LeafletPolylineInstance],
  stopMarkers: [LeafletMarkerInstance],
  buses: [...],
  stops: [...],
  routes: [...],
  assignments: {...}
}
```

## Technology Stack

```
┌─────────────────────────────────────────┐
│            Frontend Layer                │
│  • HTML5 + CSS3                         │
│  • Vanilla JavaScript (ES6+)           │
│  • Leaflet.js 1.9.4                    │
│  • OpenStreetMap Tiles                 │
└─────────────────────────────────────────┘
                    │
                    │ HTTP/REST
                    │
┌─────────────────────────────────────────┐
│            Backend Layer                 │
│  • Node.js                              │
│  • Express.js 4.18.2                   │
│  • CORS middleware                      │
└─────────────────────────────────────────┘
                    │
                    │
┌─────────────────────────────────────────┐
│            Data Layer                    │
│  • In-Memory JavaScript Objects         │
│  • (No Database - Yet!)                │
└─────────────────────────────────────────┘
                    │
                    │
┌─────────────────────────────────────────┐
│          External Services               │
│  • OwnTracks Mobile App                 │
│  • OpenStreetMap API                    │
└─────────────────────────────────────────┘
```

## Deployment Architecture

### Development
```
Developer Machine
  ├── Node.js Server (localhost:3000)
  └── Browser (localhost:3000)
```

### Production (Recommended)
```
┌──────────────────────────────────────────┐
│          Load Balancer (HTTPS)            │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│     Reverse Proxy (Nginx/Apache)         │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│        Node.js Server Instance            │
│        (with PM2/Forever)                 │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│     Database (MongoDB/PostgreSQL)         │
│     (for persistent storage)              │
└──────────────────────────────────────────┘
```

## Security Layers (To Implement)

```
┌──────────────────────────────────────────┐
│     1. HTTPS/TLS Encryption              │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│     2. Authentication Layer               │
│        (JWT/Session-based)                │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│     3. Authorization Layer                │
│        (Role-based access)                │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│     4. Input Validation                   │
│        (Schema validation)                │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│     5. Rate Limiting                      │
│        (API throttling)                   │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│     6. Application Logic                  │
└──────────────────────────────────────────┘
```

## Performance Considerations

### Current Performance
- **Response Time**: < 50ms (in-memory operations)
- **Concurrent Users**: ~100 (limited by single Node.js instance)
- **Update Frequency**: 5 seconds (configurable)
- **Data Size**: Limited by available RAM

### Optimization Strategies
```
1. Caching
   └── Redis for session/location data

2. Database Indexing
   └── Index on trackerId, busId, routeId

3. WebSocket
   └── Real-time push instead of polling

4. CDN
   └── Serve static assets from CDN

5. Load Balancing
   └── Multiple server instances

6. Database Connection Pooling
   └── Reuse database connections
```

## Monitoring Points

```
Application Metrics:
  • Request count per endpoint
  • Response time per endpoint
  • Error rate
  • Active connections

Business Metrics:
  • Number of active buses
  • Total distance traveled
  • Average ETA accuracy
  • Stop visit frequency

System Metrics:
  • CPU usage
  • Memory usage
  • Network I/O
  • Disk I/O (with database)
```

---

This architecture provides a solid foundation for a bus tracking system. For production use, implement the security, monitoring, and database layers as outlined above.

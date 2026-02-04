# OpenTop Bus Tracker 🚌

A real-time bus tracking web application that receives location data from OwnTracks and displays bus positions on an embeddable map. Perfect for tracking OpenTop tour buses along their routes.

## Features

- 📍 Real-time GPS tracking using OwnTracks
- 🗺️ Interactive map with bus locations
- 🚌 Multiple bus support with custom names and numbers
- 📱 Mobile-friendly responsive design
- 🔗 Embeddable map for websites
- 🛣️ Route creation and visualization with **automatic road-following**
- 🛑 Stop management with ordering
- 🔄 Bus-to-route assignments
- 📊 Tracker-to-bus assignments
- ⏱️ ETA (Estimated Time of Arrival) to next stop
- 🔋 Battery and speed monitoring
- ⚡ Auto-updating every 5 seconds
- 🎨 Admin panel for easy management

## Quick Start

### Installation

1. Clone the repository:
```bash
git clone https://github.com/Nathan-Dean371/Opentop-Tracker.git
cd Opentop-Tracker
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open your browser and navigate to:
   - Main dashboard: `http://localhost:3000`
   - Admin panel: `http://localhost:3000/admin`
   - Embeddable map: `http://localhost:3000/embed`

## OwnTracks Configuration

### Setup OwnTracks App

1. Download OwnTracks from your app store (iOS/Android)
2. Configure HTTP mode in OwnTracks settings:
   - **Mode**: HTTP
   - **URL**: `http://your-server-ip:3000/owntracks`
   - **Device ID**: Choose a unique identifier (e.g., "bus1", "bus2")

3. Enable location tracking and the app will start sending data automatically

### OwnTracks Data Format

The application expects OwnTracks location data in JSON format:
```json
{
  "_type": "location",
  "lat": 51.505,
  "lon": -0.09,
  "tst": 1234567890,
  "tid": "bus1",
  "batt": 85,
  "acc": 10,
  "vel": 30,
  "alt": 50
}
```

## API Endpoints

### Location Tracking

#### POST `/owntracks`
Receives location updates from OwnTracks devices.

**Request Body**: OwnTracks location JSON

**Response**: `{ "success": true }`

#### GET `/api/locations`
Returns current locations of all tracked buses.

**Response**:
```json
{
  "bus1": {
    "lat": 51.505,
    "lon": -0.09,
    "timestamp": 1234567890,
    "battery": 85,
    "accuracy": 10,
    "velocity": 30,
    "altitude": 50
  }
}
```

### Routes Management

#### GET `/api/routes`
Returns all routes.

#### POST `/api/routes`
Create a new route.

**Request Body**:
```json
{
  "name": "City Tour",
  "coordinates": [[51.505, -0.09], [51.51, -0.1]],
  "color": "#3388ff"
}
```

#### PUT `/api/routes/:id`
Update an existing route.

#### DELETE `/api/routes/:id`
Delete a route.

### Stops Management

#### GET `/api/stops`
Returns all stops.

#### POST `/api/stops`
Create a new stop.

**Request Body**:
```json
{
  "name": "Main Square",
  "lat": 51.505,
  "lon": -0.09,
  "routeId": "route-123",
  "order": 1
}
```

#### PUT `/api/stops/:id`
Update an existing stop.

#### DELETE `/api/stops/:id`
Delete a stop.

### Bus Management

#### GET `/api/buses`
Returns all buses.

#### POST `/api/buses`
Create a new bus.

**Request Body**:
```json
{
  "name": "Red Bus",
  "number": "101",
  "trackerId": "AB"
}
```

#### PUT `/api/buses/:id`
Update an existing bus.

#### DELETE `/api/buses/:id`
Delete a bus.

#### POST `/api/buses/:busId/assign-route`
Assign a bus to a route.

**Request Body**:
```json
{
  "routeId": "route-123"
}
```

### Assignments & ETA

#### GET `/api/assignments`
Returns all bus and route assignments.

**Response**:
```json
{
  "busAssignments": {
    "AB": "bus-123"
  },
  "busRouteAssignments": {
    "bus-123": "route-456"
  }
}
```

#### GET `/api/eta/:trackerId`
Get ETA information for a specific tracker.

**Response**:
```json
{
  "bus1": {
    "lat": 51.505,
    "lon": -0.09,
    "timestamp": 1234567890,
    "battery": 85,
    "accuracy": 10,
    "velocity": 30,
    "altitude": 50
  }
}
```

**Response**:
```json
{
  "trackerId": "AB",
  "busId": "bus-123",
  "routeId": "route-456",
  "nextStop": {
    "id": "stop-789",
    "name": "Main Square",
    "distance": 250,
    "eta": 120,
    "order": 2
  },
  "currentSpeed": "25.5",
  "allStops": []
}
```

### GET `/api/routes`
Returns predefined bus routes.

**Response**:
```json
[
  {
    "id": "route1",
    "name": "City Tour",
    "coordinates": [[51.505, -0.09], [51.51, -0.1]],
    "color": "#3388ff"
  }
]
```

## Using the Admin Panel

The admin panel at `/admin` provides a user-friendly interface for managing your bus tracking system.

### Managing Routes

1. Navigate to the **Routes** tab
2. Click on the map to add route points
3. Enter a route name and choose a color
4. Click "Add Route" to save
5. View and delete existing routes in the table below

### Managing Stops

1. Navigate to the **Stops** tab
2. Select a route from the dropdown
3. Either enter coordinates manually or click "Pick from Map"
4. Set the stop order (determines sequence along route)
5. Click "Add Stop" to save
6. View and delete existing stops in the table below

### Managing Buses

1. Navigate to the **Buses** tab
2. Enter bus name and number
3. Enter the OwnTracks Tracker ID (TID) to link the physical tracker
4. Click "Add Bus" to save
5. View and delete existing buses in the table below

### Assigning Buses to Routes

1. Navigate to the **Assignments** tab
2. Select a bus from the dropdown
3. Select a route from the dropdown
4. Click "Assign Bus to Route"
5. View current assignments in the table below

## How ETA Works

The ETA (Estimated Time of Arrival) feature calculates how long it will take for a bus to reach its next stop:

1. The system finds the bus's current location
2. Identifies which route the bus is assigned to
3. Finds all stops on that route
4. Calculates distance to each stop using the Haversine formula
5. Determines the closest stop as the "next stop"
6. Uses current speed to calculate ETA: `ETA = distance / speed`

**Note**: ETA requires:
- Bus must be assigned to a route
- Route must have defined stops
- Tracker must be sending velocity data
- Tracker must have recent location data

## Embedding the Map

To embed the tracker on your website, use this iframe code:

```html
<iframe 
  src="http://your-server-url:3000/embed" 
  width="800" 
  height="600" 
  frameborder="0"
  style="border: 0;">
</iframe>
```

The embedded map displays:
- All active buses with real-time positions
- Routes as colored lines
- Stops as green markers
- Bus popups showing battery, speed, and ETA to next stop
- Auto-updates every 5 seconds

## Customization

### Map View Customization

The map displays different elements:
- **Bus markers**: Red circular icons with bus graphic
- **Stop markers**: Green circular icons with "S" label
- **Route lines**: Colored polylines (customizable per route)

You can customize colors and icons by editing the SVG definitions in the HTML files.

### Data Persistence

**Important**: The current implementation stores all data in memory. When the server restarts, all routes, stops, and bus configurations will be lost.

For production use, consider implementing persistent storage:
- Add a database (MongoDB, PostgreSQL, SQLite)
- Store routes, stops, and buses in the database
- Load data on server startup
- See the "Production Considerations" section below

### Adding Custom Routes (Legacy Method)

While the admin panel is the recommended way to manage routes, you can also edit them programmatically in `server.js`:

```javascript
const routes = [
  {
    id: 'route1',
    name: 'City Center Tour',
    coordinates: [
      [51.505, -0.09],
      [51.51, -0.1],
      // Add more coordinates
    ],
    color: '#3388ff'
  }
];
```

**Note**: Use the admin panel instead for easier route management.

### Changing the Port

Set the `PORT` environment variable:
```bash
PORT=8080 npm start
```

Or modify directly in `server.js`.

## Deployment

### Deploy to a Cloud Platform

The application can be deployed to any Node.js hosting platform:

- **Heroku**: Push to Heroku with Procfile
- **Railway**: Connect your GitHub repo
- **DigitalOcean**: Deploy as a Node.js app
- **AWS/Azure**: Use their Node.js hosting services

### Environment Variables

- `PORT`: Server port (default: 3000)

## Technologies Used

- **Backend**: Node.js, Express
- **Frontend**: HTML, CSS, JavaScript
- **Mapping**: Leaflet.js with OpenStreetMap
- **Data Source**: OwnTracks

## Security Note

This basic implementation stores data in memory. For production use, consider:
- Adding authentication for the webhook endpoint and admin panel
- Using a database for persistent storage (MongoDB, PostgreSQL, SQLite)
- Implementing HTTPS
- Adding rate limiting
- Validating incoming data
- Protecting the admin panel with authentication
- Adding user roles and permissions
- Implementing audit logs for administrative actions

## Production Considerations

### Database Integration

To add persistent storage, you can integrate a database:

1. **MongoDB Example**:
```javascript
const mongoose = require('mongoose');

const RouteSchema = new mongoose.Schema({
  name: String,
  coordinates: [[Number]],
  color: String,
  createdAt: Date
});

const Route = mongoose.model('Route', RouteSchema);
```

2. **SQLite Example**:
```javascript
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./tracker.db');

db.run(`CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  name TEXT,
  coordinates TEXT,
  color TEXT,
  created_at TEXT
)`);
```

### Scaling Considerations

- Use Redis for session management
- Implement WebSocket for real-time updates
- Add load balancing for multiple server instances
- Use CDN for static assets
- Implement caching strategies

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
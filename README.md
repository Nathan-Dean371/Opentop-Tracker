# OpenTop Bus Tracker 🚌

A real-time bus tracking web application that receives location data from OwnTracks and displays bus positions on an embeddable map. Perfect for tracking OpenTop tour buses along their routes.

## Features

- 📍 Real-time GPS tracking using OwnTracks
- 🗺️ Interactive map with bus locations
- 🚌 Multiple bus support
- 📱 Mobile-friendly responsive design
- 🔗 Embeddable map for websites
- 🛣️ Route visualization
- 🔋 Battery and speed monitoring
- ⚡ Auto-updating every 5 seconds

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

### POST `/owntracks`
Receives location updates from OwnTracks devices.

**Request Body**: OwnTracks location JSON

**Response**: `{ "success": true }`

### GET `/api/locations`
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

### GET `/api/routes`
Returns predefined bus routes.

**Response**:
```json
[
  {
    "id": "route1",
    "name": "City Tour",
    "coordinates": [[51.505, -0.09], [51.51, -0.1]]
  }
]
```

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

## Customization

### Adding Custom Routes

Edit the `/api/routes` endpoint in `server.js` to define your bus routes:

```javascript
const routes = [
  {
    id: 'route1',
    name: 'City Center Tour',
    coordinates: [
      [51.505, -0.09],
      [51.51, -0.1],
      // Add more coordinates
    ]
  }
];
```

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
- Adding authentication for the webhook endpoint
- Using a database for persistent storage
- Implementing HTTPS
- Adding rate limiting
- Validating incoming data

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
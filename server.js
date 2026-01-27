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

// In-memory storage for bus locations
let busLocations = {};

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
  // Example route - you can customize this
  const routes = [
    {
      id: 'route1',
      name: 'City Tour',
      coordinates: [
        [51.505, -0.09],
        [51.51, -0.1],
        [51.51, -0.12],
        [51.505, -0.13],
        [51.505, -0.09]
      ]
    }
  ];
  res.json(routes);
});

// Serve the map page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Embeddable map page
app.get('/embed', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'embed.html'));
});

app.listen(PORT, () => {
  console.log(`OpenTop Tracker server running on port ${PORT}`);
  console.log(`Map available at: http://localhost:${PORT}`);
  console.log(`Embeddable map at: http://localhost:${PORT}/embed`);
  console.log(`OwnTracks webhook endpoint: http://localhost:${PORT}/owntracks`);
});

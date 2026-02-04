# Google Maps Import Feature - Quick Reference

## What's New?

You can now import routes and stops directly from Google Maps into OpenTop Tracker!

## Quick Steps

### Import Routes from Google Maps

1. Create your route in [Google My Maps](https://www.google.com/mymaps)
2. Export as KML (Menu → Export to KML/KMZ → choose KML)
3. Go to Admin Panel → Routes tab
4. Scroll to "Import from Google Maps" section
5. Upload your KML file
6. Done! Your routes and stops are imported

### Import Stops from CSV

1. Create a CSV file with this format:
   ```
   Name,Latitude,Longitude
   Stop 1,51.5074,-0.1278
   Stop 2,51.5155,-0.0922
   ```
2. Go to Admin Panel → Stops tab
3. Upload your CSV file
4. Done! Your stops are imported

## Sample Files

Two sample files are included in the repository for testing:
- `sample-google-maps-route.kml` - Example route with stops
- `sample-google-maps-stops.csv` - Example CSV stops

## More Information

See [GOOGLE-MAPS-IMPORT.md](GOOGLE-MAPS-IMPORT.md) for:
- Detailed instructions
- Troubleshooting
- API documentation
- Technical details

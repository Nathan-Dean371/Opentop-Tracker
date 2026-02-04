# Google Maps Import Feature

## Overview
The OpenTop Tracker now supports importing routes and stops directly from Google Maps exports. This feature allows you to plan your routes and stops in Google My Maps and then import them into the tracking system.

## Supported Formats

### KML Format (Recommended)
- **Routes**: LineString placemarks are imported as routes
- **Stops**: Point placemarks are imported as stops
- **How to export from Google My Maps**:
  1. Go to [Google My Maps](https://www.google.com/mymaps)
  2. Open your map containing routes and/or stops
  3. Click the menu (⋮) next to the map title
  4. Select "Export to KML/KMZ"
  5. Choose "KML" format (not KMZ)
  6. Download the file

### CSV Format
- **Stops only**: Import point locations from CSV files
- **Required columns**: 
  - Name (or Title)
  - Latitude (or Lat)
  - Longitude (or Lon/Lng)
- **Example CSV**:
  ```csv
  Name,Latitude,Longitude
  Stop 1,51.5074,-0.1278
  Stop 2,51.5155,-0.0922
  ```

## How to Import

### Routes Tab
1. Navigate to the **Routes** tab in the Admin Panel
2. Scroll down to the "Import from Google Maps" section
3. Click "Choose File" and select your KML file
4. Click "Import Routes/Stops"
5. Routes and stops will be automatically added to your system

### Stops Tab
1. Navigate to the **Stops** tab in the Admin Panel
2. Scroll down to the "Import from Google Maps" section
3. Click "Choose File" and select your KML or CSV file
4. Click "Import Stops"
5. Stops will be automatically added to your system

## What Gets Imported

### From KML Files:
- **LineStrings** → Routes with coordinates and waypoints
- **Points** → Stops with name and location
- Route names from placemark names
- Stop names from placemark names

### From CSV Files:
- **Each row** → A stop with name and location
- Stops are ordered by their position in the file

## After Importing

### Routes
- Imported routes appear in the "Existing Routes" table
- Each route retains its original name from Google Maps
- Routes are assigned a default color (blue) - you can modify this later
- Routes can be deleted if needed

### Stops
- Imported stops appear in the "Existing Stops" table
- Stops are not automatically assigned to routes
- You can manually assign stops to routes using the edit functionality
- Stop order is preserved from the import file

## Tips and Best Practices

1. **Use meaningful names** in Google My Maps - these will be imported as-is
2. **Create separate layers** in Google My Maps for different routes
3. **Export one route at a time** for better organization
4. **Review imported data** in the tables before using in production
5. **Test with sample files** provided in the repository:
   - `sample-google-maps-route.kml` - Example route with stops
   - `sample-google-maps-stops.csv` - Example CSV stops

## Troubleshooting

### Import fails or returns empty results
- **Check file format**: Ensure the file is a valid KML or CSV
- **Verify coordinates**: Latitude should be between -90 and 90, Longitude between -180 and 180
- **Check KML structure**: Make sure the KML contains LineString or Point elements
- **CSV headers**: Ensure your CSV has proper headers (Name, Latitude, Longitude)

### Coordinates appear incorrect
- Google Maps KML uses **longitude, latitude** order (lon, lat)
- The import function automatically converts these to the correct format
- If you see inverted coordinates, check your source file

### Routes don't appear on the map
- Imported routes have coordinates but may need manual refresh
- Try reloading the page after import
- Check that the route has at least 2 coordinate points

## API Endpoint

The import functionality is available via REST API:

**Endpoint**: `POST /api/import/google-maps`

**Request**: Multipart form data with a file field

**Response**:
```json
{
  "success": true,
  "routes": [...],
  "stops": [...],
  "message": "Imported X route(s) and Y stop(s)"
}
```

**Example using curl**:
```bash
curl -X POST \
  -F "file=@my-route.kml" \
  http://localhost:3000/api/import/google-maps
```

## Technical Details

### KML Parsing
- Uses regex-based parsing for simplicity and no external dependencies
- Extracts CDATA-wrapped names and plain text names
- Handles both single and multi-part LineStrings
- Automatically filters invalid coordinates

### CSV Parsing
- Smart header detection (searches first 5 rows)
- Case-insensitive column matching
- Flexible column names (Name/Title, Latitude/Lat, Longitude/Lon/Lng)
- Falls back to positional parsing if no headers found

### File Handling
- Files are temporarily stored in the `uploads/` directory
- Automatic cleanup after processing (success or failure)
- File size is limited by the system's default upload limits
- Supports UTF-8 encoded files

## Security Considerations

- File uploads are restricted to the server's upload directory
- Files are deleted immediately after processing
- No executable code is processed from uploaded files
- Large files may impact server performance during parsing

## Future Enhancements

Potential improvements for future versions:
- Support for KMZ (zipped KML) files
- Batch import of multiple files
- Route color preservation from Google Maps
- Automatic route assignment for imported stops
- Preview before import
- GeoJSON support
- GPX track support

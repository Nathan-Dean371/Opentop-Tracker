#!/usr/bin/env python3
"""
Test script for OpenTop Bus Tracker

This script tests the core functionality of the tracker:
1. Sending OwnTracks data to the webhook
2. Retrieving location data
3. Getting route information
"""

import json
import urllib.request
import time


def send_location(device_id, lat, lon, battery=100, velocity=0):
    """Send a location update to the OwnTracks webhook"""
    data = {
        "_type": "location",
        "lat": lat,
        "lon": lon,
        "tst": int(time.time()),
        "tid": device_id,
        "batt": battery,
        "acc": 10,
        "vel": velocity,
        "alt": 50
    }
    
    req = urllib.request.Request(
        'http://localhost:3000/owntracks',
        data=json.dumps(data).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    
    response = urllib.request.urlopen(req)
    return json.loads(response.read().decode())


def get_locations():
    """Get all current bus locations"""
    response = urllib.request.urlopen('http://localhost:3000/api/locations')
    return json.loads(response.read().decode())


def get_routes():
    """Get all defined routes"""
    response = urllib.request.urlopen('http://localhost:3000/api/routes')
    return json.loads(response.read().decode())


def test_single_bus():
    """Test tracking a single bus"""
    print("Test 1: Single bus tracking")
    result = send_location("test-bus", 51.505, -0.09, 85, 15)
    assert result['success'] == True
    
    locations = get_locations()
    assert 'test-bus' in locations
    assert locations['test-bus']['lat'] == 51.505
    assert locations['test-bus']['lon'] == -0.09
    print("✓ Single bus tracking works")


def test_multiple_buses():
    """Test tracking multiple buses simultaneously"""
    print("\nTest 2: Multiple bus tracking")
    
    buses = [
        ("bus1", 51.505, -0.09, 85, 15),
        ("bus2", 51.510, -0.10, 72, 20),
        ("bus3", 51.507, -0.11, 90, 10)
    ]
    
    for device_id, lat, lon, batt, vel in buses:
        send_location(device_id, lat, lon, batt, vel)
    
    locations = get_locations()
    assert len(locations) >= 3
    print(f"✓ Multiple bus tracking works ({len(locations)} buses tracked)")


def test_routes():
    """Test route retrieval"""
    print("\nTest 3: Route data")
    routes = get_routes()
    assert isinstance(routes, list)
    assert len(routes) > 0
    assert 'coordinates' in routes[0]
    print(f"✓ Route data works ({len(routes)} routes available)")


def test_location_update():
    """Test updating an existing bus location"""
    print("\nTest 4: Location updates")
    
    # Send initial location
    send_location("update-test", 51.505, -0.09, 85, 15)
    locations = get_locations()
    initial_lat = locations['update-test']['lat']
    
    # Update location
    send_location("update-test", 51.510, -0.10, 80, 20)
    locations = get_locations()
    updated_lat = locations['update-test']['lat']
    
    assert initial_lat != updated_lat
    assert updated_lat == 51.510
    print("✓ Location updates work correctly")


if __name__ == "__main__":
    print("OpenTop Bus Tracker - Test Suite")
    print("=" * 50)
    
    try:
        test_single_bus()
        test_multiple_buses()
        test_routes()
        test_location_update()
        
        print("\n" + "=" * 50)
        print("All tests passed! ✓")
        
    except Exception as e:
        print(f"\n✗ Test failed: {e}")
        raise

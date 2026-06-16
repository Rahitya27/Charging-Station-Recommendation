import React, { useState, useEffect, useCallback } from 'react';
import { MapPin, Zap, Star, Navigation, DollarSign, Clock, Info } from 'lucide-react';

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================
// This is the entry point of your application
// It manages the overall state and renders all sub-components

const EVChargingFinder = () => {
  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================
  // These variables store the application's data and trigger re-renders when changed
  
  const [userLocation, setUserLocation] = useState(null); // Stores user's GPS coordinates
  const [stations, setStations] = useState([]); // Array of all nearby charging stations
  const [topStations, setTopStations] = useState([]); // Top 3 recommended stations
  const [loading, setLoading] = useState(false); // Shows loading spinner
  const [error, setError] = useState(null); // Displays error messages
  const [map, setMap] = useState(null); // Google Maps object reference
  const [selectedStation, setSelectedStation] = useState(null); // Currently selected station
  
  // Google Maps API key - Replace with your own key
  // Get free key from: https://console.cloud.google.com/google/maps-apis
  const GOOGLE_MAPS_API_KEY = 'YOUR_API_KEY_HERE';

  // ============================================================================
  // LOAD GOOGLE MAPS SCRIPT
  // ============================================================================
  // This useEffect runs once when component mounts
  // It dynamically loads Google Maps JavaScript library
  
  useEffect(() => {
    // Check if Google Maps is already loaded
    if (window.google && window.google.maps) {
      return;
    }

    // Create script element to load Google Maps
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.defer = true;
    
    // Handle successful load
    script.onload = () => {
      console.log('Google Maps API loaded successfully');
    };
    
    // Handle load errors
    script.onerror = () => {
      setError('Failed to load Google Maps. Please check your API key.');
    };
    
    document.head.appendChild(script);
    
    // Cleanup function (removes script when component unmounts)
    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  // ============================================================================
  // GET USER'S CURRENT LOCATION
  // ============================================================================
  // Uses browser's Geolocation API to get GPS coordinates
  
  const getUserLocation = useCallback(() => {
    setLoading(true);
    setError(null);

    // Check if browser supports geolocation
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      setLoading(false);
      return;
    }

    // Request user's location
    navigator.geolocation.getCurrentPosition(
      // Success callback
      (position) => {
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        setUserLocation(location);
        findNearbyStations(location);
      },
      // Error callback
      (error) => {
        setError(`Error getting location: ${error.message}`);
        setLoading(false);
      },
      // Options
      {
        enableHighAccuracy: true, // Use GPS if available
        timeout: 10000, // Wait max 10 seconds
        maximumAge: 0 // Don't use cached position
      }
    );
  }, []);

  // ============================================================================
  // FIND NEARBY CHARGING STATIONS
  // ============================================================================
  // Uses Google Places API to search for EV charging stations
  
  const findNearbyStations = useCallback((location) => {
    // Wait for Google Maps to be fully loaded
    if (!window.google || !window.google.maps) {
      setTimeout(() => findNearbyStations(location), 500);
      return;
    }

    // Create a map instance (hidden, used for Places API)
    const mapInstance = new window.google.maps.Map(document.createElement('div'), {
      center: location,
      zoom: 13
    });

    // Create Places service
    const service = new window.google.maps.places.PlacesService(mapInstance);

    // Search request parameters
    const request = {
      location: new window.google.maps.LatLng(location.lat, location.lng),
      radius: 5000, // Search within 5km radius
      keyword: 'electric vehicle charging station', // Search term
      type: 'electric_vehicle_charging_station' // Place type
    };

    // Execute the search
    service.nearbySearch(request, (results, status) => {
      if (status === window.google.maps.places.PlacesServiceStatus.OK) {
        // Process and enrich station data
        const enrichedStations = results.map(station => 
          enrichStationData(station, location)
        );
        
        setStations(enrichedStations);
        rankStations(enrichedStations);
        setLoading(false);
        
        // Initialize map for display
        initializeMap(location, enrichedStations);
      } else {
        setError(`Error finding stations: ${status}`);
        setLoading(false);
      }
    });
  }, []);

  // ============================================================================
  // ENRICH STATION DATA
  // ============================================================================
  // Adds calculated fields like distance and estimated charging types
  
  const enrichStationData = (station, userLocation) => {
    // Calculate distance from user to station (in kilometers)
    const distance = calculateDistance(
      userLocation.lat,
      userLocation.lng,
      station.geometry.location.lat(),
      station.geometry.location.lng()
    );

    // Estimate charging type based on station name/keywords
    const chargingTypes = estimateChargingTypes(station.name, station.types);

    // Estimate pricing (mock data for demo - in real app, use pricing API)
    const pricing = estimatePricing(chargingTypes);

    return {
      id: station.place_id,
      name: station.name,
      address: station.vicinity,
      location: {
        lat: station.geometry.location.lat(),
        lng: station.geometry.location.lng()
      },
      distance: distance,
      rating: station.rating || 0,
      totalRatings: station.user_ratings_total || 0,
      chargingTypes: chargingTypes,
      pricing: pricing,
      isOpen: station.opening_hours?.open_now ?? null,
      photos: station.photos || []
    };
  };

  // ============================================================================
  // CALCULATE DISTANCE (HAVERSINE FORMULA)
  // ============================================================================
  // Calculates distance between two GPS coordinates on Earth's surface
  
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in kilometers
  };

  // ============================================================================
  // ESTIMATE CHARGING TYPES
  // ============================================================================
  // Infers charging connector types from station name/description
  
  const estimateChargingTypes = (name, types) => {
    const nameLower = name.toLowerCase();
    const detectedTypes = [];

    // Check for Tesla Supercharger
    if (nameLower.includes('tesla') || nameLower.includes('supercharger')) {
      detectedTypes.push('Tesla Supercharger');
    }
    
    // Check for DC Fast Charging
    if (nameLower.includes('dc fast') || nameLower.includes('chademo') || 
        nameLower.includes('ccs') || nameLower.includes('fast')) {
      detectedTypes.push('DC Fast Charging');
    }
    
    // Check for Level 2
    if (nameLower.includes('level 2') || nameLower.includes('j1772') ||
        detectedTypes.length === 0) {
      detectedTypes.push('Level 2');
    }

    return detectedTypes.length > 0 ? detectedTypes : ['Level 2'];
  };

  // ============================================================================
  // ESTIMATE PRICING
  // ============================================================================
  // Mock pricing data based on charging type (for demo purposes)
  
  const estimatePricing = (chargingTypes) => {
    // In a real app, fetch this from a pricing API
    if (chargingTypes.includes('Tesla Supercharger')) {
      return { amount: 0.28, unit: '$/kWh', type: 'per_kwh' };
    } else if (chargingTypes.includes('DC Fast Charging')) {
      return { amount: 0.35, unit: '$/kWh', type: 'per_kwh' };
    } else {
      return { amount: 0.15, unit: '$/kWh', type: 'per_kwh' };
    }
  };

  // ============================================================================
  // RANKING ALGORITHM
  // ============================================================================
  // Scores each station based on distance, rating, charging speed, and price
  
  const rankStations = (stations) => {
    const scored = stations.map(station => {
      // DISTANCE SCORE (0-10): Closer is better
      // 0km = 10 points, 5km = 0 points (linear decay)
      const distanceScore = Math.max(0, 10 - (station.distance / 5) * 10);

      // RATING SCORE (0-10): Higher rating is better
      // Scale 0-5 star rating to 0-10 points, with bonus for many reviews
      const ratingScore = station.rating * 2;
      const reviewBonus = Math.min(1, station.totalRatings / 100); // Up to 1 point for 100+ reviews
      const finalRatingScore = Math.min(10, ratingScore + reviewBonus);

      // CHARGING SPEED SCORE (0-10): Faster is better
      let speedScore = 5; // Default for Level 2
      if (station.chargingTypes.includes('DC Fast Charging')) {
        speedScore = 8;
      }
      if (station.chargingTypes.includes('Tesla Supercharger')) {
        speedScore = 10;
      }

      // PRICE SCORE (0-10): Cheaper is better
      // $0.10/kWh = 10 points, $0.50/kWh = 0 points (linear)
      const priceScore = Math.max(0, 10 - (station.pricing.amount - 0.10) * 25);

      // WEIGHTED TOTAL SCORE
      // You can adjust these weights based on what's most important
      const weights = {
        distance: 0.35,  // 35% weight - proximity is important
        rating: 0.25,    // 25% weight - quality matters
        speed: 0.25,     // 25% weight - charging speed matters
        price: 0.15      // 15% weight - price is a factor
      };

      const totalScore = 
        distanceScore * weights.distance +
        finalRatingScore * weights.rating +
        speedScore * weights.speed +
        priceScore * weights.price;

      return {
        ...station,
        scores: {
          distance: distanceScore.toFixed(1),
          rating: finalRatingScore.toFixed(1),
          speed: speedScore.toFixed(1),
          price: priceScore.toFixed(1),
          total: totalScore.toFixed(1)
        }
      };
    });

    // Sort by total score (highest first) and take top 3
    const ranked = scored.sort((a, b) => b.scores.total - a.scores.total);
    setTopStations(ranked.slice(0, 3));
  };

  // ============================================================================
  // INITIALIZE GOOGLE MAP DISPLAY
  // ============================================================================
  // Creates the interactive map with markers for each station
  
  const initializeMap = (center, stations) => {
    if (!window.google || !window.google.maps) return;

    const mapElement = document.getElementById('map');
    if (!mapElement) return;

    // Create map instance
    const mapInstance = new window.google.maps.Map(mapElement, {
      center: center,
      zoom: 13,
      styles: [
        {
          featureType: 'poi',
          elementType: 'labels',
          stylers: [{ visibility: 'off' }]
        }
      ]
    });

    // Add user location marker (blue dot)
    new window.google.maps.Marker({
      position: center,
      map: mapInstance,
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#4A90E2',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2
      },
      title: 'Your Location'
    });

    // Add markers for each charging station
    stations.forEach((station, index) => {
      const marker = new window.google.maps.Marker({
        position: station.location,
        map: mapInstance,
        title: station.name,
        label: {
          text: (index + 1).toString(),
          color: 'white',
          fontSize: '12px',
          fontWeight: 'bold'
        },
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: '#10B981',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2
        }
      });

      // Add click listener to marker
      marker.addListener('click', () => {
        setSelectedStation(station);
        mapInstance.panTo(station.location);
        mapInstance.setZoom(15);
      });
    });

    setMap(mapInstance);
  };

  // ============================================================================
  // RENDER EXPLANATION FOR RANKING
  // ============================================================================
  // Generates human-readable explanation of why a station is recommended
  
  const getRecommendationReason = (station, rank) => {
    const reasons = [];

    // Distance factor
    if (parseFloat(station.scores.distance) > 7) {
      reasons.push(`very close (${station.distance.toFixed(1)}km)`);
    } else if (parseFloat(station.scores.distance) > 4) {
      reasons.push(`nearby (${station.distance.toFixed(1)}km)`);
    }

    // Rating factor
    if (parseFloat(station.scores.rating) > 8) {
      reasons.push(`excellent ratings (${station.rating}/5 stars)`);
    } else if (parseFloat(station.scores.rating) > 6) {
      reasons.push(`good ratings (${station.rating}/5 stars)`);
    }

    // Speed factor
    if (station.chargingTypes.includes('Tesla Supercharger')) {
      reasons.push('fastest Tesla charging');
    } else if (station.chargingTypes.includes('DC Fast Charging')) {
      reasons.push('fast charging available');
    }

    // Price factor
    if (parseFloat(station.scores.price) > 7) {
      reasons.push(`affordable (${station.pricing.amount}${station.pricing.unit})`);
    }

    const reasonText = reasons.length > 0 
      ? reasons.join(', ')
      : 'balanced option across all factors';

    const medals = ['🥇', '🥈', '🥉'];
    return `${medals[rank - 1]} Best for: ${reasonText}`;
  };

  // ============================================================================
  // JSX RENDER
  // ============================================================================
  // This defines the HTML structure and styling of the app
  
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    }}>
      {/* Header Section */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.95)',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        padding: '24px',
        marginBottom: '24px'
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
            <Zap size={40} color="#667eea" strokeWidth={2.5} />
            <h1 style={{
              margin: 0,
              fontSize: '32px',
              fontWeight: '800',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}>
              EV Charging Station Finder
            </h1>
          </div>
          <p style={{
            margin: '0',
            color: '#64748b',
            fontSize: '16px'
          }}>
            Find the best electric vehicle charging stations near you
          </p>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 24px 24px' }}>
        {/* Find Stations Button */}
        {!userLocation && (
          <div style={{
            background: 'white',
            borderRadius: '16px',
            padding: '48px',
            textAlign: 'center',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)'
          }}>
            <Zap size={64} color="#667eea" strokeWidth={2} style={{ marginBottom: '24px' }} />
            <h2 style={{ fontSize: '28px', marginBottom: '16px', color: '#1e293b' }}>
              Ready to charge?
            </h2>
            <p style={{ color: '#64748b', marginBottom: '32px', fontSize: '16px' }}>
              We'll find the best charging stations near your location
            </p>
            <button
              onClick={getUserLocation}
              disabled={loading}
              style={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '16px 48px',
                fontSize: '18px',
                fontWeight: '600',
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)',
                transition: 'all 0.3s ease',
                opacity: loading ? 0.7 : 1
              }}
              onMouseOver={(e) => {
                if (!loading) e.target.style.transform = 'translateY(-2px)';
              }}
              onMouseOut={(e) => {
                e.target.style.transform = 'translateY(0)';
              }}
            >
              {loading ? 'Finding your location...' : 'Find Charging Stations'}
            </button>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div style={{
            background: '#fee',
            border: '1px solid #fcc',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '24px',
            color: '#c33'
          }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Map Container */}
        {userLocation && (
          <div style={{
            background: 'white',
            borderRadius: '16px',
            overflow: 'hidden',
            marginBottom: '24px',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)'
          }}>
            <div
              id="map"
              style={{
                width: '100%',
                height: '400px',
                background: '#f1f5f9'
              }}
            />
          </div>
        )}

        {/* Top 3 Recommendations */}
        {topStations.length > 0 && (
          <div>
            <h2 style={{
              fontSize: '28px',
              color: 'white',
              marginBottom: '24px',
              fontWeight: '700',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <Star size={32} fill="#fbbf24" color="#fbbf24" />
              Top 3 Recommendations
            </h2>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '24px'
            }}>
              {topStations.map((station, index) => (
                <div
                  key={station.id}
                  style={{
                    background: 'white',
                    borderRadius: '16px',
                    padding: '24px',
                    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)',
                    transition: 'all 0.3s ease',
                    cursor: 'pointer',
                    border: selectedStation?.id === station.id ? '3px solid #667eea' : '3px solid transparent'
                  }}
                  onClick={() => {
                    setSelectedStation(station);
                    if (map) {
                      map.panTo(station.location);
                      map.setZoom(15);
                    }
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.transform = 'translateY(-4px)';
                    e.currentTarget.style.boxShadow = '0 15px 40px rgba(0, 0, 0, 0.15)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.1)';
                  }}
                >
                  {/* Rank Badge */}
                  <div style={{
                    display: 'inline-block',
                    background: index === 0 ? '#fbbf24' : index === 1 ? '#94a3b8' : '#f97316',
                    color: 'white',
                    padding: '6px 16px',
                    borderRadius: '20px',
                    fontSize: '14px',
                    fontWeight: '700',
                    marginBottom: '16px'
                  }}>
                    #{index + 1} Recommended
                  </div>

                  {/* Station Name */}
                  <h3 style={{
                    fontSize: '20px',
                    fontWeight: '700',
                    color: '#1e293b',
                    marginBottom: '8px'
                  }}>
                    {station.name}
                  </h3>

                  {/* Address */}
                  <p style={{
                    color: '#64748b',
                    fontSize: '14px',
                    marginBottom: '16px',
                    display: 'flex',
                    alignItems: 'start',
                    gap: '8px'
                  }}>
                    <MapPin size={16} style={{ marginTop: '2px', flexShrink: 0 }} />
                    <span>{station.address}</span>
                  </p>

                  {/* Stats Grid */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '12px',
                    marginBottom: '16px'
                  }}>
                    {/* Distance */}
                    <div style={{
                      background: '#f8fafc',
                      padding: '12px',
                      borderRadius: '8px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <Navigation size={14} color="#667eea" />
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>Distance</span>
                      </div>
                      <div style={{ fontSize: '18px', fontWeight: '700', color: '#1e293b' }}>
                        {station.distance.toFixed(1)} km
                      </div>
                    </div>

                    {/* Rating */}
                    <div style={{
                      background: '#f8fafc',
                      padding: '12px',
                      borderRadius: '8px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <Star size={14} color="#fbbf24" fill="#fbbf24" />
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>Rating</span>
                      </div>
                      <div style={{ fontSize: '18px', fontWeight: '700', color: '#1e293b' }}>
                        {station.rating}/5
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '400', marginLeft: '4px' }}>
                          ({station.totalRatings})
                        </span>
                      </div>
                    </div>

                    {/* Charging Types */}
                    <div style={{
                      background: '#f8fafc',
                      padding: '12px',
                      borderRadius: '8px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <Zap size={14} color="#10b981" />
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>Type</span>
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#1e293b' }}>
                        {station.chargingTypes[0]}
                      </div>
                    </div>

                    {/* Pricing */}
                    <div style={{
                      background: '#f8fafc',
                      padding: '12px',
                      borderRadius: '8px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <DollarSign size={14} color="#f59e0b" />
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>Price</span>
                      </div>
                      <div style={{ fontSize: '18px', fontWeight: '700', color: '#1e293b' }}>
                        {station.pricing.amount}{station.pricing.unit}
                      </div>
                    </div>
                  </div>

                  {/* Recommendation Reason */}
                  <div style={{
                    background: 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)',
                    padding: '12px',
                    borderRadius: '8px',
                    marginBottom: '16px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'start', gap: '8px' }}>
                      <Info size={16} color="#7c3aed" style={{ marginTop: '2px', flexShrink: 0 }} />
                      <div style={{ fontSize: '13px', color: '#5b21b6', lineHeight: '1.5' }}>
                        {getRecommendationReason(station, index + 1)}
                      </div>
                    </div>
                  </div>

                  {/* Score Breakdown */}
                  <div style={{
                    borderTop: '1px solid #e2e8f0',
                    paddingTop: '16px'
                  }}>
                    <div style={{
                      fontSize: '12px',
                      color: '#64748b',
                      fontWeight: '600',
                      marginBottom: '8px'
                    }}>
                      Score Breakdown
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <div style={{
                        background: '#f1f5f9',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: '600'
                      }}>
                        Distance: {station.scores.distance}/10
                      </div>
                      <div style={{
                        background: '#f1f5f9',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: '600'
                      }}>
                        Rating: {station.scores.rating}/10
                      </div>
                      <div style={{
                        background: '#f1f5f9',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: '600'
                      }}>
                        Speed: {station.scores.speed}/10
                      </div>
                      <div style={{
                        background: '#f1f5f9',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: '600'
                      }}>
                        Price: {station.scores.price}/10
                      </div>
                    </div>
                    <div style={{
                      marginTop: '8px',
                      fontSize: '14px',
                      fontWeight: '700',
                      color: '#667eea'
                    }}>
                      Total Score: {station.scores.total}/10
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All Stations List */}
        {stations.length > 3 && (
          <div style={{ marginTop: '48px' }}>
            <h2 style={{
              fontSize: '24px',
              color: 'white',
              marginBottom: '24px',
              fontWeight: '700'
            }}>
              All Nearby Stations ({stations.length})
            </h2>
            
            <div style={{
              background: 'white',
              borderRadius: '16px',
              padding: '24px',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)'
            }}>
              {stations.map((station, index) => (
                <div
                  key={station.id}
                  style={{
                    padding: '16px',
                    borderBottom: index < stations.length - 1 ? '1px solid #e2e8f0' : 'none',
                    cursor: 'pointer',
                    transition: 'background 0.2s ease'
                  }}
                  onClick={() => {
                    setSelectedStation(station);
                    if (map) {
                      map.panTo(station.location);
                      map.setZoom(15);
                    }
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = '#f8fafc';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '16px' }}>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '600', color: '#1e293b' }}>
                        {station.name}
                      </h4>
                      <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>
                        {station.address}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '16px', fontWeight: '700', color: '#667eea', marginBottom: '4px' }}>
                        {station.distance.toFixed(1)} km
                      </div>
                      <div style={{ fontSize: '14px', color: '#64748b' }}>
                        ⭐ {station.rating}/5
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Export component as default
export default EVChargingFinder;
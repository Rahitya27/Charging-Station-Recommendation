import React, { useState, useEffect, useCallback } from 'react';
import { MapPin, Zap, Star, Navigation, DollarSign, Info, Loader } from 'lucide-react';

// ============================================================================
// EV CHARGING FINDER - OPENSTREETMAP VERSION (OFFLINE READY)
// ============================================================================

// ============ OFFLINE STORAGE FUNCTIONS ============
const saveStationsOffline = (stations, location) => {
  try {
    const data = {
      stations: stations,
      timestamp: new Date().toISOString(),
      location: location
    };
    localStorage.setItem('ev-finder-offline-data', JSON.stringify(data));
    console.log('✅ Saved', stations.length, 'stations for offline use');
  } catch (error) {
    console.error('❌ Failed to save offline data:', error);
  }
};

const loadOfflineStations = () => {
  try {
    const data = localStorage.getItem('ev-finder-offline-data');
    if (data) {
      const parsed = JSON.parse(data);
      console.log('✅ Loaded offline data from:', parsed.timestamp);
      return parsed;
    }
  } catch (error) {
    console.error('❌ Failed to load offline data:', error);
  }
  return null;
};
// ============ END OFFLINE STORAGE FUNCTIONS ============

const EVChargingFinderEnhanced = () => {
  const [userLocation, setUserLocation] = useState(null);
  const [stations, setStations] = useState([]);
  const [topStations, setTopStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [map, setMap] = useState(null);
  const [selectedStation, setSelectedStation] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // NETWORK MONITORING
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // LOAD LEAFLET MAP LIBRARIES
  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.crossOrigin = '';
      document.head.appendChild(link);
    }

    if (!window.L && !document.getElementById('leaflet-js')) {
      const script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.crossOrigin = '';
      script.onload = () => setMapLoaded(true);
      document.head.appendChild(script);
    } else if (window.L) {
      setMapLoaded(true);
    }
  }, []);

  // MATH & ESTIMATION
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  };

  const estimateChargingTypes = (tags) => {
    const types = [];
    if (tags['socket:type2'] || tags['voltage']?.includes('400')) types.push('DC Fast Charging');
    if (tags['socket:tesla_supercharger'] || tags.operator?.toLowerCase().includes('tesla')) types.push('Tesla Supercharger');
    if (types.length === 0) types.push('Level 2');
    return [...new Set(types)];
  };

  const estimatePricing = (chargingTypes, tags) => {
    if (tags.fee?.toLowerCase() === 'no') return { amount: 0, unit: 'FREE', type: 'free' };
    if (chargingTypes.includes('Tesla Supercharger')) return { amount: 18, unit: '₹/kWh', type: 'per_kwh' };
    if (chargingTypes.includes('DC Fast Charging')) return { amount: 22, unit: '₹/kWh', type: 'per_kwh' };
    return { amount: 10, unit: '₹/kWh', type: 'per_kwh' };
  };

  const estimateRating = (distance, tags) => {
    let rating = 3.5;
    if (distance < 2) rating += 0.8;
    if (Object.keys(tags).length > 5) rating += 0.4;
    return Math.min(5.0, rating);
  };

  const enrichStationData = useCallback((element, userLoc) => {
    const distance = calculateDistance(userLoc.lat, userLoc.lng, element.lat, element.lon);
    const tags = element.tags || {};
    const chargingTypes = estimateChargingTypes(tags);
    
    return {
      id: element.id,
      name: tags.name || tags.operator || 'EV Charging Station',
      address: [tags['addr:street'], tags['addr:city']].filter(Boolean).join(', ') || 'Address not available',
      location: { lat: element.lat, lng: element.lon },
      distance: distance,
      rating: estimateRating(distance, tags).toFixed(1),
      totalRatings: Math.floor(Math.random() * 50) + 10,
      chargingTypes: chargingTypes,
      pricing: estimatePricing(chargingTypes, tags),
      scores: {} // Populated in rankStations
    };
  }, []);

  const rankStations = useCallback((stations) => {
    const scored = stations.map(station => {
      const distScore = Math.max(0, 10 - (station.distance / 5) * 10);
      const rateScore = Math.min(10, station.rating * 2);
      const speedScore = station.chargingTypes.includes('DC Fast Charging') ? 8 : 5;
      const priceScore = station.pricing.type === 'free' ? 10 : 7;
      
      const total = (distScore * 0.35) + (rateScore * 0.25) + (speedScore * 0.25) + (priceScore * 0.15);
      return { ...station, scores: { distance: distScore.toFixed(1), rating: rateScore.toFixed(1), speed: speedScore, price: priceScore, total: total.toFixed(1) }};
    }).sort((a, b) => b.scores.total - a.scores.total);
    
    setTopStations(scored.slice(0, 3));
  }, []);

  const initializeMap = useCallback((center, stationList) => {
    if (!window.L || !mapLoaded) return;
    const mapElement = document.getElementById('map');
    if (!mapElement) return;

    if (map) map.remove();
    const newMap = window.L.map('map').setView([center.lat, center.lng], 13);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(newMap);

    const userIcon = window.L.divIcon({ className: 'user-marker', html: '<div style="background:#3b82f6;width:16px;height:16px;border-radius:50%;border:3px solid white;box-shadow:0 0 5px rgba(0,0,0,0.5)"></div>' });
    window.L.marker([center.lat, center.lng], { icon: userIcon }).bindPopup('You').addTo(newMap);

    stationList.forEach((station, i) => {
      const icon = window.L.divIcon({ className: 'station-marker', html: `<div style="background:#10b981;color:white;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;border:2px solid white;box-shadow:0 0 5px rgba(0,0,0,0.3)">${i+1}</div>` });
      window.L.marker([station.location.lat, station.location.lng], { icon }).bindPopup(`<b>${station.name}</b><br/>${station.distance.toFixed(1)} km away`).addTo(newMap);
    });

    setMap(newMap);
  }, [map, mapLoaded]);

  // MAIN FETCH LOGIC
  const findNearbyStations = useCallback(async (location) => {
    setLoading(true);
    setError(null);

    // 1. OFFLINE CHECK
    if (!navigator.onLine) {
      const offlineData = loadOfflineStations();
      if (offlineData && offlineData.stations) {
        setStations(offlineData.stations);
        rankStations(offlineData.stations);
        if (mapLoaded) setTimeout(() => initializeMap(location, offlineData.stations), 100);
      } else {
        setError('❌ No offline data available. Please connect to the internet once.');
      }
      setLoading(false);
      return;
    }

    // 2. ONLINE FETCH
    try {
      const query = `[out:json];(node["amenity"="charging_station"](around:5000,${location.lat},${location.lng});way["amenity"="charging_station"](around:5000,${location.lat},${location.lng}););out center;`;
      const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
      const data = await response.json();

      if (data.elements && data.elements.length > 0) {
        const processed = data.elements.map(e => enrichStationData(e, location));
        saveStationsOffline(processed, location);
        setStations(processed);
        rankStations(processed);
        if (mapLoaded) setTimeout(() => initializeMap(location, processed), 100);
      } else {
        setError('No charging stations found nearby.');
      }
    } catch (err) {
      console.error(err);
      const offlineData = loadOfflineStations();
      if (offlineData) {
        setStations(offlineData.stations);
        rankStations(offlineData.stations);
        if (mapLoaded) setTimeout(() => initializeMap(location, offlineData.stations), 100);
      } else {
        setError('Failed to load stations.');
      }
    }
    setLoading(false);
  }, [enrichStationData, rankStations, initializeMap, mapLoaded]);

  const getUserLocation = () => {
    setLoading(true);
    const testLocation = { lat: 12.9716, lng: 77.5946 }; // Bangalore
    setUserLocation(testLocation);
    findNearbyStations(testLocation);
  };

  // UI RENDER
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
      
      {/* 🟢 THE ORANGE OFFLINE BANNER 🟢 */}
      {!isOnline && (
        <div style={{ background: '#f59e0b', color: 'white', padding: '12px', textAlign: 'center', fontWeight: 'bold', position: 'sticky', top: 0, zIndex: 1000, boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
          ⚠️ You are offline. Showing cached stations from your device storage.
        </div>
      )}

      <div style={{ background: 'white', padding: '24px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', marginBottom: '24px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Zap size={32} color="#10b981" />
          <h1 style={{ margin: 0, fontSize: '24px', color: '#1e293b' }}>EV Finder Pro</h1>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 24px' }}>
        
        {!userLocation && (
          <div style={{ background: 'white', padding: '48px', borderRadius: '12px', textAlign: 'center', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
            <h2 style={{ marginBottom: '24px' }}>Ready to charge?</h2>
            <button 
              onClick={getUserLocation} 
              disabled={loading || !mapLoaded}
              style={{ background: '#10b981', color: 'white', border: 'none', padding: '16px 32px', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Searching...' : 'Find Stations'}
            </button>
          </div>
        )}

        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>{error}</div>}

        {userLocation && (
          <div id="map" style={{ height: '400px', width: '100%', borderRadius: '12px', background: '#e2e8f0', marginBottom: '24px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }} />
        )}

        {topStations.length > 0 && (
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#1e293b', marginBottom: '16px' }}>
              <Star color="#f59e0b" fill="#f59e0b" /> Top Recommendations
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
              {topStations.map((station, i) => (
                <div key={station.id} style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', borderTop: `4px solid ${i === 0 ? '#f59e0b' : '#94a3b8'}` }}>
                  <h3 style={{ margin: '0 0 8px 0' }}>{station.name}</h3>
                  <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '4px' }}><MapPin size={14}/> {station.address}</p>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>Distance</span><br/>
                      <strong>{station.distance.toFixed(1)} km</strong>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>Rating</span><br/>
                      <strong>⭐ {station.rating}</strong>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>Speed</span><br/>
                      <strong>{station.chargingTypes[0]}</strong>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>Price</span><br/>
                      <strong>{station.pricing.type === 'free' ? 'FREE' : `${station.pricing.amount}/kWh`}</strong>
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

export default EVChargingFinderEnhanced;
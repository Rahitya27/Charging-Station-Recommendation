import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapPin, Zap, Star, Navigation, Search, List, Clock, ChevronLeft } from 'lucide-react';

const STORAGE_KEY = 'ev-finder-offline-data';
const HISTORY_KEY = 'ev-finder-search-history';

const saveStationsOffline = (stations, location, cityName) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ stations, timestamp: new Date().toISOString(), location, cityName })); } catch (e) {}
};

const loadOfflineStations = () => {
  try { const data = localStorage.getItem(STORAGE_KEY); if (data) return JSON.parse(data); } catch (e) {} return null;
};

const saveHistory = (city) => {
  if (!city) return;
  try {
    let history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    history = history.filter(item => item.toLowerCase() !== city.toLowerCase()); 
    history.unshift(city); 
    if (history.length > 3) history.pop(); 
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (e) {}
};

const getHistory = () => {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch (e) { return []; }
};

const EVChargingFinderOSM = () => {
  const [appView, setAppView] = useState('home');
  const [, setUserLocation] = useState(null);
  
  // We use the full stations array to fetch ALL addresses now
  const [stations, setStations] = useState([]); 
  const [topStations, setTopStations] = useState([]);
  const [otherStations, setOtherStations] = useState([]);
  
  const [error, setError] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [realAddresses, setRealAddresses] = useState({});
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  
  const mapRef = useRef(null);

  useEffect(() => {
    setSearchHistory(getHistory());
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link'); link.id = 'leaflet-css'; link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(link);
    }
    if (!window.L && !document.getElementById('leaflet-js')) {
      const script = document.createElement('script'); script.id = 'leaflet-js'; script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; 
      script.onload = () => setMapLoaded(true); document.head.appendChild(script);
    } else if (window.L) setMapLoaded(true);

    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); };
  }, []);

  // UPDATED: Fetch addresses for ALL stations safely (1 second delay per station to prevent API blocking)
  useEffect(() => {
    const fetchAddresses = async () => {
      if (stations.length === 0 || isOffline) return; 
      const updatedAddresses = { ...realAddresses };
      
      for (let i = 0; i < stations.length; i++) {
        const st = stations[i];
        if (!updatedAddresses[st.id]) {
          try {
            await new Promise(r => setTimeout(r, 1000)); // Crucial 1-second delay for OpenStreetMap
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${st.location.lat}&lon=${st.location.lng}`);
            const data = await res.json();
            updatedAddresses[st.id] = data.display_name || st.address;
            setRealAddresses({ ...updatedAddresses });
          } catch (err) { updatedAddresses[st.id] = "Address lookup failed."; }
        }
      }
    };
    if (appView === 'results') fetchAddresses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, isOffline, appView]);

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  };

  const enrichStationData = useCallback((element, userLoc) => {
    const distance = calculateDistance(userLoc.lat, userLoc.lng, element.lat, element.lon);
    const tags = element.tags || {};
    let types = [];
    if (tags['socket:type2'] || tags['socket:chademo']) types.push('DC Fast'); else types.push('Level 2');
    return {
      id: element.id, name: tags.name || tags.operator || 'Public EV Charging Station',
      address: [tags['addr:street'], tags['addr:city']].filter(Boolean).join(', ') || 'Address available on map',
      location: { lat: element.lat, lng: element.lon }, distance,
      chargingTypes: types
    };
  }, []);

  const rankStations = useCallback((stationsList) => {
    const ranked = stationsList.sort((a, b) => a.distance - b.distance);
    setStations(ranked); // Stores ALL stations to trigger the address fetcher
    setTopStations(ranked.slice(0, 3));
    setOtherStations(ranked.slice(3)); 
  }, []);

  const initializeMap = useCallback((center, stationsList, zoom = 13) => {
    setTimeout(() => {
      if (!window.L || !document.getElementById('map')) return;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      
      const newMap = window.L.map('map').setView([center.lat, center.lng], zoom);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(newMap);
      window.L.marker([center.lat, center.lng]).bindPopup('<b>Search Location</b>').addTo(newMap);
      
      stationsList.forEach((st, index) => {
        const num = index + 1;
        const markerHtml = `<div style="background-color: #20c997; color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4);">${num}</div>`;
        const customIcon = window.L.divIcon({ html: markerHtml, className: '', iconSize: [28, 28], iconAnchor: [14, 14] });
        window.L.marker([st.location.lat, st.location.lng], { icon: customIcon }).bindPopup(`<b>#${num} - ${st.name}</b><br/>${st.distance.toFixed(1)} km away`).addTo(newMap);
      });
      mapRef.current = newMap;
    }, 100); 
  }, []);

  const executeSearch = async (queryText) => {
    if (!queryText.trim()) return;
    setShowDropdown(false); setError(null); setRealAddresses({});
    saveHistory(queryText); setSearchHistory(getHistory()); setSearchQuery(queryText);
    setAppView('results');

    if (isOffline) {
      const offlineData = loadOfflineStations();
      if (offlineData && offlineData.stations) {
        rankStations(offlineData.stations); 
        initializeMap(offlineData.location, offlineData.stations, 13);
      } else setError('No offline data saved yet. Please connect to the internet.');
      return;
    }

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryText + ', India')}`);
      const data = await res.json();
      if (data && data.length > 0) {
        const loc = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        setUserLocation(loc); 
        
        const query = `[out:json][timeout:25];(node["amenity"="charging_station"](around:7000,${loc.lat},${loc.lng}););out body;>;out skel qt;`;
        const osmRes = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
        const osmData = await osmRes.json();
        
        if (osmData.elements.length > 0) {
          const processed = osmData.elements.filter(e => e.lat).map(e => enrichStationData(e, loc));
          saveStationsOffline(processed, loc, queryText); 
          rankStations(processed);
          initializeMap(loc, processed.sort((a,b) => a.distance - b.distance), 13);
        } else {
          setError('No stations found nearby this location.');
          initializeMap(loc, [], 13);
        }
      } else setError("City not found. Please check spelling.");
    } catch (err) { setError("Network error during search."); }
  };

  const handleFormSubmit = (e) => { e.preventDefault(); executeSearch(searchQuery); };

  const getRealLocation = () => {
    setError(null); setRealAddresses({}); setShowDropdown(false);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const loc = { lat: position.coords.latitude, lng: position.coords.longitude };
          setUserLocation(loc); setSearchQuery("My GPS Location"); setAppView('results');
          
          const fetchGPS = async () => {
            try {
              const query = `[out:json][timeout:25];(node["amenity"="charging_station"](around:7000,${loc.lat},${loc.lng}););out body;>;out skel qt;`;
              const osmRes = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
              const osmData = await osmRes.json();
              if (osmData.elements.length > 0) {
                const processed = osmData.elements.filter(e => e.lat).map(e => enrichStationData(e, loc));
                saveStationsOffline(processed, loc, "My GPS Location"); 
                rankStations(processed);
                initializeMap(loc, processed.sort((a,b) => a.distance - b.distance), 13);
              } else setError('No stations found nearby your GPS location.');
            } catch (err) { setError("Network error."); }
          };
          if (!isOffline) fetchGPS(); else executeSearch("My GPS Location");
        },
        () => { setError("GPS denied. Use the search bar."); }
      );
    } else setError("GPS not supported.");
  };

  const getPillColor = (index) => {
    if (index === 0) return '#f59e0b'; 
    if (index === 1) return '#94a3b8'; 
    return '#f97316'; 
  };

  if (appView === 'home') {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)', fontFamily: 'sans-serif', padding: '20px' }}>
        {isOffline && <div style={{ position: 'absolute', top: 0, width: '100%', background: '#ef4444', color: 'white', padding: '10px', textAlign: 'center', fontWeight: 'bold' }}>⚠️ Offline Mode Active</div>}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{ background: '#20c997', width: '80px', height: '80px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', boxShadow: '0 10px 25px rgba(32, 201, 151, 0.4)' }}>
            <Zap size={48} fill="white" color="white" />
          </div>
          <h1 style={{ color: '#1e293b', fontSize: '36px', margin: '0 0 12px 0', fontWeight: '800' }}>Find EV Charging Stations</h1>
          <p style={{ color: '#64748b', fontSize: '18px', margin: 0 }}>Discover the fastest routes to chargers across India.</p>
        </div>

        <div style={{ position: 'relative', width: '100%', maxWidth: '600px' }}>
          <form onSubmit={handleFormSubmit} style={{ display: 'flex', background: 'white', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)', overflow: 'visible', border: '1px solid #cbd5e1' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', paddingLeft: '16px' }}>
              <Search size={24} color="#94a3b8" />
              <input type="text" placeholder="Enter city name..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onFocus={() => setShowDropdown(true)} onBlur={() => setTimeout(() => setShowDropdown(false), 200)} style={{ width: '100%', padding: '20px 16px', border: 'none', fontSize: '18px', outline: 'none', background: 'transparent' }} />
            </div>
            <button type="button" onClick={getRealLocation} disabled={!mapLoaded} style={{ background: 'transparent', border: 'none', padding: '0 20px', cursor: 'pointer', borderLeft: '1px solid #e2e8f0', color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', transition: '0.2s' }}>
              <Navigation size={20} /> GPS
            </button>
            <button type="submit" disabled={!mapLoaded} style={{ background: '#20c997', color: 'white', border: 'none', padding: '0 32px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', borderRadius: '0 12px 12px 0' }}>
              Search
            </button>
          </form>

          {showDropdown && searchHistory.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', borderRadius: '8px', marginTop: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0', zIndex: 50, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', fontSize: '12px', fontWeight: 'bold', color: '#94a3b8', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>RECENT SEARCHES</div>
              {searchHistory.map((city, index) => (
                <div key={index} onClick={() => executeSearch(city)} style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', borderBottom: index !== searchHistory.length - 1 ? '1px solid #f1f5f9' : 'none', color: '#334155', fontWeight: '500', transition: 'background 0.2s' }} onMouseEnter={(e) => e.target.style.background = '#f8fafc'} onMouseLeave={(e) => e.target.style.background = 'white'}>
                  <Clock size={16} color="#94a3b8" /> {city}
                </div>
              ))}
            </div>
          )}
          {error && <div style={{ color: '#ef4444', marginTop: '16px', fontWeight: 'bold', textAlign: 'center' }}>⚠️ {error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'sans-serif', paddingBottom: '60px' }}>
      <div style={{ background: '#20c997', padding: '16px 5%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 10px rgba(0,0,0,0.1)', position: 'sticky', top: 0, zIndex: 100 }}>
        <button onClick={() => setAppView('home')} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '10px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
          <ChevronLeft size={20} /> Back
        </button>
        <h2 style={{ color: 'white', margin: 0, fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={24} fill="white" /> {searchQuery}
        </h2>
        <div style={{ width: '80px' }}></div> 
      </div>

      <div style={{ maxWidth: '1400px', margin: '24px auto', padding: '0 5%' }}>
        {error && <div style={{ background: '#fee2e2', color: '#dc2626', padding: '16px', borderRadius: '8px', marginBottom: '24px', fontWeight: 'bold', textAlign: 'center' }}>⚠️ {error}</div>}

        <div style={{ background: 'white', borderRadius: '16px', padding: '8px', marginBottom: '40px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
          <div id="map" style={{ width: '100%', height: '400px', borderRadius: '12px', background: '#e2e8f0', zIndex: 1 }} />
        </div>

        {/* TOP 3 RECOMMENDATIONS */}
        {topStations.length > 0 && (
          <div>
            <h2 style={{ color: '#1e293b', fontSize: '24px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Star fill="#fbbf24" color="#fbbf24" size={28} /> Top 3 Optimal Stations
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '40px' }}>
              {topStations.map((st, i) => (
                <div key={st.id} style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', borderTop: `4px solid ${getPillColor(i)}` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ background: getPillColor(i), color: 'white', padding: '4px 12px', borderRadius: '20px', display: 'inline-block', marginBottom: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                      Rank #{i+1}
                    </div>
                    <h3 style={{ margin: '0 0 8px 0', color: '#0f172a', fontSize: '20px' }}>{st.name}</h3>
                    
                    <div style={{ display: 'flex', gap: '8px', color: '#475569', margin: '8px 0', fontSize: '13px', lineHeight: '1.4' }}>
                      <MapPin size={16} style={{ flexShrink: 0, marginTop: '2px', color: '#ef4444' }} /> 
                      <span style={{ fontWeight: '500' }}>{realAddresses[st.id] ? realAddresses[st.id] : '⏳ Fetching precise street address...'}</span>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '16px' }}>
                      <div style={{ background: '#f8fafc', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 'bold', marginBottom: '2px' }}>DISTANCE</div>
                        <div style={{ fontWeight: 'bold', color: '#1e293b', fontSize: '16px' }}>{st.distance.toFixed(1)} km</div>
                      </div>
                      <div style={{ background: '#f8fafc', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 'bold', marginBottom: '2px' }}>PLUG TYPE</div>
                        <div style={{ fontWeight: 'bold', color: '#10b981', fontSize: '16px' }}>{st.chargingTypes[0]}</div>
                      </div>
                    </div>
                  </div>

                  {/* OFFICIAL GOOGLE MAPS TURN-BY-TURN INTENT URL */}
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${st.location.lat},${st.location.lng}&travelmode=driving&dir_action=navigate`} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#3b82f6', color: 'white', padding: '12px', borderRadius: '8px', textDecoration: 'none', fontWeight: 'bold', marginTop: '20px' }}>
                    <Navigation size={16} /> Start Navigation
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ALL OTHER STATIONS (With Addresses Enabled) */}
        {otherStations.length > 0 && (
          <div>
            <h2 style={{ color: '#1e293b', fontSize: '24px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <List color="#64748b" size={28} /> All Other Stations Nearby
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
              {otherStations.map((st, i) => (
                <div key={st.id} style={{ background: 'white', padding: '20px', borderRadius: '12px', display: 'flex', gap: '16px', alignItems: 'flex-start', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9' }}>
                  
                  <div style={{ background: '#e2e8f0', color: '#475569', width: '40px', height: '40px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '16px', flexShrink: 0, marginTop: '4px' }}>
                    {i + 4}
                  </div>
                  
                  <div style={{ flex: 1 }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '18px', color: '#1e293b' }}>{st.name}</h4>
                    
                    <div style={{ display: 'flex', gap: '6px', color: '#64748b', margin: '8px 0', fontSize: '13px', lineHeight: '1.4' }}>
                      <MapPin size={14} style={{ flexShrink: 0, marginTop: '2px' }} /> 
                      <span style={{ fontWeight: '500' }}>{realAddresses[st.id] ? realAddresses[st.id] : '⏳ Fetching address...'}</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                      <span style={{ fontWeight: 'bold', color: '#20c997', fontSize: '14px' }}>{st.distance.toFixed(1)} km away</span>
                      
                      {/* OFFICIAL GOOGLE MAPS TURN-BY-TURN INTENT URL */}
                      <a href={`https://www.google.com/maps/dir/?api=1&destination=${st.location.lat},${st.location.lng}&travelmode=driving&dir_action=navigate`} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', fontSize: '14px', fontWeight: 'bold', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', background: '#eff6ff', padding: '6px 12px', borderRadius: '6px' }}>
                         <Navigation size={14} /> Drive
                      </a>
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

export default EVChargingFinderOSM;
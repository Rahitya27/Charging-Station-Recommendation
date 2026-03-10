
import React from 'react';
import ReactDOM from 'react-dom/client';
import EVChargingFinderEnhanced from './ev-charging-finder-enhanced';

// Get the root element from HTML
const root = ReactDOM.createRoot(document.getElementById('root'));

// Render the OpenStreetMap version (NO API KEY NEEDED!)
root.render(
  <React.StrictMode>
  <EVChargingFinderEnhanced />
  </React.StrictMode>
);
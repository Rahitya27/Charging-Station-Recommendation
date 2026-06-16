import React from 'react';
import ReactDOM from 'react-dom/client';
// Notice this line now points to the OSM file!
import EVChargingFinderOSM from './ev-charging-finder-osm';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <EVChargingFinderOSM />
  </React.StrictMode>
);
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { registerMaskProvider } from './engine/masks';
import { browserMaskProvider } from './services/mediapipeMaskProvider';
import './index.css';

// Preview and export both use this single lazy provider through the shared renderer.
registerMaskProvider(browserMaskProvider);

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

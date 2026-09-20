import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Register PWA Service Worker
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[Service Worker] Registered successfully:', registration.scope);

        // Track updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[Service Worker] New update available');
                const event = new CustomEvent('swUpdateAvailable', { detail: registration });
                window.dispatchEvent(event);
              }
            });
          }
        });

        // Check if there is already a waiting service worker on load
        if (registration.waiting) {
          console.log('[Service Worker] Waiting worker found on load');
          const event = new CustomEvent('swUpdateAvailable', { detail: registration });
          window.dispatchEvent(event);
        }
      })
      .catch((error) => {
        console.error('[Service Worker] Registration failed:', error);
      });
  });

  // Handle page refresh once the new service worker takes control
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);


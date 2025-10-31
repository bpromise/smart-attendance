import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
// PWA: register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      // ask for background sync when we come online
      window.addEventListener('online', () => {
        reg.sync?.register('sync-outbox').catch(() => {});
      });
    } catch (e) {
      console.warn('SW register failed', e);
    }
  });
}

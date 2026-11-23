import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// Needed for push notifications and for installing to the home screen.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('service worker registration failed', e));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

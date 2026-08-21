import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

/**
 * Register the service worker, which makes the app open without a connection.
 *
 * Only in production. In development it would serve a cached build over the dev
 * server and every change would appear not to have happened — a confusing
 * failure that costs more than offline support is worth while iterating.
 *
 * Registration is deliberately last and failure is swallowed: this is an
 * improvement to how the app loads, and an app that refuses to start because it
 * could not install a cache would be worse than no cache.
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch(err => console.warn("[sw] registration failed", err));
  });
}

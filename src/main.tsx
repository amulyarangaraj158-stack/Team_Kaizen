import { createRoot } from 'react-dom/client';
import './lib/monaco';
import App from './App.tsx';
import { ErrorBoundary } from './components/ui/SafeMonaco.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary fallbackTitle="AutoPatch AI encountered an unexpected error">
    <App />
  </ErrorBoundary>
);

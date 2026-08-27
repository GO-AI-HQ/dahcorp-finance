import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SessionProvider } from './hooks/useSession.js';
import { App } from './App.js';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing.');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/app';
import { bindDeviceAuth } from './app/bind-device-auth';
import './styles/app.css';

bindDeviceAuth();

const root = document.getElementById('root');
if (!root) throw new Error('root is missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

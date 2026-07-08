import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, getStoredTheme } from './theme';
import './styles.css';

// Apply the saved theme before the first render to avoid a flash.
applyTheme(getStoredTheme());

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

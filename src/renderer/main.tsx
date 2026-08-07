import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

console.log('[ELECTRON IPC AUDIT] window.electron:', (window as any).electron);
console.log('[ELECTRON IPC AUDIT] window.api:', (window as any).api);
console.log('[ELECTRON IPC AUDIT] import.meta.env:', import.meta.env);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

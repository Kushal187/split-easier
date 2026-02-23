import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import App from './App.jsx';
import './index.css';

registerSW({ immediate: true });

const standaloneMedia = window.matchMedia('(display-mode: standalone)');
const isIOS = /iPad|iPhone|iPod/.test(window.navigator.userAgent);

function applyRuntimeDisplayClasses() {
  const inStandalone = standaloneMedia.matches || window.navigator.standalone === true;
  document.documentElement.classList.toggle('is-standalone', inStandalone);
  document.documentElement.classList.toggle('is-ios', isIOS);
}

applyRuntimeDisplayClasses();

if (typeof standaloneMedia.addEventListener === 'function') {
  standaloneMedia.addEventListener('change', applyRuntimeDisplayClasses);
} else if (typeof standaloneMedia.addListener === 'function') {
  standaloneMedia.addListener(applyRuntimeDisplayClasses);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);

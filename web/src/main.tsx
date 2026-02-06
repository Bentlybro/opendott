import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import FlashPage from './pages/Flash.tsx'

// Handle GitHub Pages SPA redirect (from 404.html)
// If we have ?p=/some/path, redirect to that path
function RedirectHandler() {
  const params = new URLSearchParams(window.location.search);
  const path = params.get('p');
  if (path) {
    // Clean up the URL and navigate
    window.history.replaceState(null, '', path);
    return <Navigate to={path} replace />;
  }
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RedirectHandler />} />
        <Route path="/flash" element={<FlashPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)

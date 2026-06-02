import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles/globals.css'

// When a lazy page chunk can't be fetched (new deploy replaced the old hashed
// filenames), Vite fires this event. Reload once to pick up the fresh bundle
// instead of leaving the user on a broken/blank screen.
window.addEventListener('vite:preloadError', function () {
  var last = Number(sessionStorage.getItem('nlh-chunk-reload') || 0)
  if (Date.now() - last > 10000) {
    sessionStorage.setItem('nlh-chunk-reload', String(Date.now()))
    window.location.reload()
  }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)

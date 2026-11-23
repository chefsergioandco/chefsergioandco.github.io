import React from 'react'
import { createRoot } from 'react-dom/client'
import { AdminProvider } from './store'
import App from './App'
import './styles.css'
import './Kiosk.css'
import './DashboardChrome.css'
createRoot(document.getElementById('root')!).render(<React.StrictMode><AdminProvider><App/></AdminProvider></React.StrictMode>)

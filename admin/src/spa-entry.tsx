import React, { lazy, Suspense } from 'react'
export { configureAdminApi, getAdminNavigation } from './api-client'
export type { AdminApiOptions, AdminNavigation } from './api-client'

// The host owns the React root and Auth0. Load workspace CSS only on this route.
const Workspace = lazy(async () => {
  await Promise.all([import('./styles.css'), import('./Kiosk.css'), import('./DashboardChrome.css')])
  const [{ default: App }, { AdminProvider }] = await Promise.all([import('./App'), import('./store')])
  return { default: function WorkspaceContent() { return <AdminProvider><App/></AdminProvider> } }
})

export function AdminPortal() {
  return <Suspense fallback={<main aria-busy="true"><p role="status">Opening your workspace…</p></main>}><Workspace/></Suspense>
}

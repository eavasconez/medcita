import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Heavy libraries get their own chunks, named by what they are, instead of being
// folded into the page that happens to import them first. They are only
// downloaded by the pages that use them (Dashboard: calendar; Reports: charts),
// and they stay cached across app releases because their hash only changes when
// the library does.
const CHUNKS = {
  // The base every page shares. Without its own chunk, Rollup parks react / react-dom
  // inside whichever heavy chunk imports them, and the entry would then have to
  // download the calendar library just to render the login page.
  'vendor-react': ['react', 'react-dom', 'scheduler', 'react-router', 'react-router-dom', 'react-is'],
  'vendor-calendar': ['react-big-calendar', 'dom-helpers', 'uncontrollable', 'memoize-one', 'date-arithmetic'],
  'vendor-charts': ['recharts', 'victory-vendor', 'd3-', 'internmap', '@reduxjs/toolkit', 'react-redux', 'redux', 'reselect', 'immer', 'es-toolkit', 'decimal.js-light', 'eventemitter3', 'tiny-invariant', 'use-sync-external-store'],
}

function manualChunks(id) {
  const match = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
  if (!match) return undefined
  const pkg = match[1]
  for (const [chunk, packages] of Object.entries(CHUNKS)) {
    if (packages.some((name) => (name.endsWith('-') ? pkg.startsWith(name) : pkg === name))) return chunk
  }
  return undefined
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: { manualChunks },
    },
  },
})

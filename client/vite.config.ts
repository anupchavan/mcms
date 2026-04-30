import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Public path when the app is hosted under a subpath (e.g. Netlify /mcms → /mcms). Default "/". */
function publicBase(): string {
  const raw = process.env.VITE_BASE_PATH?.trim()
  if (!raw || raw === '/') return '/'
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`
  return `${withSlash.replace(/\/$/, '')}/`
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  base: publicBase(),
}))

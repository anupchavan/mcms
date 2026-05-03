import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/** Match server static mount `/mcms` (see server/src/server.ts). Must end with `/` for Vite. */
function viteBase(raw: string | undefined): string {
	if (raw === undefined || raw === '' || raw === '/') return '/'
	const trimmed = raw.trim().replace(/^\/+|\/+$/g, '')
	return trimmed ? `/${trimmed}/` : '/'
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '')
	const base = viteBase(env.VITE_BASE_PATH || process.env.VITE_BASE_PATH)
	return {
		plugins: [react()],
		base,
	}
})

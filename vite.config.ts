import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Project Pages serve from a subpath (https://<user>.github.io/<repo>/),
// so the production build needs that base for asset URLs to resolve.
// Dev server keeps '/' for convenience.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/spec-decomp-planning/' : '/',
  plugins: [react()],
}));

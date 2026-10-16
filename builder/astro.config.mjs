// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://geyen.org',
  outDir: process.env.OUT_DIR ?? './dist',
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // Keep CSS in files so nginx can send a strict Content-Security-Policy.
    inlineStylesheets: 'never',
  },
  vite: {
    build: { assetsInlineLimit: 0 },
  },
});

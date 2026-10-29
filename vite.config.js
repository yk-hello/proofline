import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { copyFileSync } from 'node:fs';

const mathjaxVersion = createRequire(import.meta.url)('mathjax-full/package.json').version;

export default defineConfig({
  base: './',
  plugins: [react(), { name: 'redline-brand', closeBundle() { copyFileSync(new URL('./build/redline.png', import.meta.url), new URL('./dist/redline.png', import.meta.url)); } }],
  // MathJax otherwise looks up its version through Node's require at runtime.
  define: { PACKAGE_VERSION: JSON.stringify(mathjaxVersion) },
  worker: { format: 'es' },
  server: { watch: { ignored: ['**/test-fixtures/**', '**/output/**', '**/tmp/**'] } },
});

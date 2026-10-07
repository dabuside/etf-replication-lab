import { defineConfig } from 'vite';

// The published artifact is a single self-contained HTML file, so the site
// itself stays dependency-free. Vite is used only as a dev server here;
// `npm run build` produces the standalone file via src/cli/build.ts.
export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});

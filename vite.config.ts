import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the built game works from any sub-folder
  // (e.g. GitHub Pages serves it at https://<user>.github.io/<repo>/).
  base: './',
});

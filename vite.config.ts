import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    // Префікс шляху, під яким роздається зібраний застосунок (Фаза G3,
    // docs/migration-plan.md маркетплейсу). У проді — '/studio/', щоб Nova
    // жила на одному origin із маркетплейсом і ділила з ним стан входу
    // Firebase. Порожня змінна = звичайний корінь, як і було.
    // Vite підставляє це значення в import.meta.env.BASE_URL, звідки його
    // читає src/utils/basePath.ts.
    base: process.env.NOVA_BASE_PATH || '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

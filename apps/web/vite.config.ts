import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Bundle splitting (B15). Separa dos vendors estables en chunks propios:
        //   - firebase-vendor: todo el SDK de Firebase (app/auth/firestore/
        //     functions) y sus paquetes @firebase/*. Sigue en el camino crítico
        //     del arranque (AuthProvider lo inicializa al boot), pero aislarlo
        //     mejora cache entre deploys y permite descarga en paralelo.
        //   - react-vendor: react/react-dom/react-router(-dom)/scheduler. No
        //     reduce el entry (carga igual al inicio) pero su chunk es estable
        //     entre deploys → cache hit en redespliegues continuos de Vercel.
        // NOTA: los transitivos pesados de Firestore (gRPC, protobufjs, long,
        // idb) NO se enrutan aquí: quedan en el vendor por defecto. Decisión
        // consciente de B15 (regex simple > firebase-vendor "completo"). Si el
        // vendor por defecto resulta desproporcionado en producción, abrir
        // sub-bloque trivial para enrutarlos explícitamente.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/[\\/]node_modules[\\/](@firebase|firebase)[\\/]/.test(id)) {
            return 'firebase-vendor';
          }
          if (
            /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(
              id,
            )
          ) {
            return 'react-vendor';
          }
          // Resto (radix-ui, lucide-react, clsx, cva, tailwind-merge…) → chunks
          // vendor por defecto de Rollup, hoisteados según el grafo de uso.
        },
      },
    },
  },
});

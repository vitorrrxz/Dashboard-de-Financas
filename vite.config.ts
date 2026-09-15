import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // FIN-117 — Recharts (e as libs de gráfico de que depende, como d3-*) só é usado no
        // Dashboard (carregado de cara) e em Relatórios (sob demanda desde FIN-117), mas ainda
        // assim é grande o bastante para, sozinho, empurrar o pedaço principal do build acima do
        // aviso de 500 kB. Isolado num pedaço próprio, o pedaço principal cai abaixo do limite —
        // o total baixado pela Dashboard não muda, mas os dois pedaços carregam em paralelo.
        manualChunks(id) {
          if (/node_modules\/(recharts|d3-[^/]+|victory-vendor)\//.test(id)) return 'charts';
        },
      },
    },
  },
})

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  // Fase 6: mismo plugin que vite.config.ts — necesario para que el JSX
  // automático de los .test.tsx de cliente transforme igual que el resto
  // de la app (los componentes no importan React explícitamente en ningún
  // sitio, ver client/src/components/segolife/*.tsx).
  plugins: [react()],
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    // Fase 6: tests de componentes React del frontend público de Segolife
    // (client/**) corren en jsdom; el resto del repo (server/**) sigue en
    // "node" — mismo archivo de config, sin duplicar uno aparte.
    environmentMatchGlobs: [["client/**", "jsdom"]],
    setupFiles: ["./client/src/test/setup.ts"],
    include: ["server/**/*.test.ts", "server/**/*.spec.ts", "client/**/*.test.tsx", "client/**/*.test.ts", "shared/**/*.test.ts"],
  },
});

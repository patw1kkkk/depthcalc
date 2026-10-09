import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        home: resolve("index.html"),
        capture: resolve("apps/capture/index.html"),
        studio: resolve("apps/studio/index.html"),
      },
    },
  },
});

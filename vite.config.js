import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { config } from "./server/config.js";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": { target: `http://127.0.0.1:${config.port}`, ws: true },
      "/assets/teaching": `http://127.0.0.1:${config.port}`,
    },
  },
});

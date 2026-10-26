import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const target = process.env.STOREWHY_API_TARGET ?? "http://127.0.0.1:3100";
const proxy = { "/api": { target }, "/healthz": { target } };
export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
});

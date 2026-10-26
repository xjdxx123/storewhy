import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const target = process.env.STOREWHY_API_TARGET ?? "http://127.0.0.1:3100";
const headers = process.env.STOREWHY_SHARE_TOKEN
  ? { "x-storewhy-access-key": process.env.STOREWHY_SHARE_TOKEN }
  : undefined;
const proxy = { "/api": { target, headers }, "/healthz": { target, headers } };
export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
});

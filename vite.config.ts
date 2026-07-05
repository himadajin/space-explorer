import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/space-explorer/" : "/",
  plugins: [react()],
}));

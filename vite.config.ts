import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/mechanica-descent/",
  build: {
    cssMinify: false,
    minify: false,
  },
});

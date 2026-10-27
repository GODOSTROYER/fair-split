import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The console SPA (register §6). The router plugin must run before the React plugin.
export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true, quoteStyle: "double", semicolons: true }),
    react(),
    tailwindcss(),
  ],
  build: {
    target: "es2023",
    sourcemap: true,
  },
});

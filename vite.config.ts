import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ command }) => ({
  plugins: [
    tanstackStart({
      server: { entry: "server" },
    }),
    command === "build"
      ? nitro({
          preset: "cloudflare-pages",
          output: {
            dir: path.resolve(__dirname, ".output/public"),
            publicDir: path.resolve(__dirname, ".output/public"),
            serverDir: path.resolve(__dirname, ".output/public/_worker.js"),
          },
        })
      : undefined,
    viteReact(),
    tailwindcss(),
    tsconfigPaths(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));

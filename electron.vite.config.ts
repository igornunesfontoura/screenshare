import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {},
  preload: {
    build: {
      // Preload com sandbox ativo precisa ser CommonJS.
      rollupOptions: {
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    server: {
      watch: {
        // .omc é reescrito o tempo todo por ferramentas e causaria full reloads.
        ignored: ["**/server/**", "**/.omc/**", "**/release/**"],
      },
    },
  },
});

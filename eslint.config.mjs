import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Minecraft-Köpfe sind winzige Pixelgrafiken von mc-heads.net; next/image würde sie weichzeichnen.
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build-Ordner der Live-Kopie (Versionswechsel ohne Ausfall, scripts/deploy.sh) und lokale Hilfsdateien
    ".next-*/**",
    ".next.tmp/**",
    "scripts/.tmp/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;

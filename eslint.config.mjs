import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // eslint-plugin-react cannot auto-detect the React version under ESLint 10,
    // so state it explicitly.
    settings: { react: { version: "19.2" } },
  },
  globalIgnores([".next/**", "node_modules/**", "out/**", "build/**", "coverage/**", "next-env.d.ts", "tsconfig.tsbuildinfo"]),
]);

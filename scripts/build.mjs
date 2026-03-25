import { build } from "esbuild";

await build({
  entryPoints: ["src/extension/content.entry.jsx"],
  outfile: "src/extension/content.js",
  bundle: true,
  format: "iife",
  target: ["chrome120"],
  platform: "browser",
  sourcemap: false,
  jsx: "automatic",
  logLevel: "info"
});
/**
 * esbuild.mjs — Build script for the rAPI extension.
 *
 * Produces two bundles:
 *   1. dist/extension.js         — Node.js CJS bundle for the extension host
 *   2. dist/webview/webview.js   — Browser IIFE bundle for the React webview
 *
 * CSS is injected inline by a small plugin so it works inside the webview
 * without needing a separate <link> tag.
 */

import * as esbuild from "esbuild";
import { readFile } from "fs/promises";

const watch = process.argv.includes("--watch");

// ─── Plugin: inline CSS imports as <style> injection ────────────────────────
const inlineCssPlugin = {
  name: "inline-css",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const css = await readFile(args.path, "utf-8");
      // Escape backticks and backslashes for template literal
      const escaped = css.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
      return {
        contents: `
          (function() {
            const style = document.createElement('style');
            style.textContent = \`${escaped}\`;
            document.head.appendChild(style);
          })();
        `,
        loader: "js",
      };
    });
  },
};

// ─── Extension host bundle ──────────────────────────────────────────────────
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  sourcemap: true,
  target: "node18",
};

// ─── Webview bundle ─────────────────────────────────────────────────────────
const webviewConfig = {
  entryPoints: ["src/webview/index.tsx"],
  bundle: true,
  outfile: "dist/webview/webview.js",
  format: "iife",
  platform: "browser",
  sourcemap: true,
  target: "es2020",
  plugins: [inlineCssPlugin],
  loader: { ".tsx": "tsx", ".ts": "ts" },
  define: { "process.env.NODE_ENV": '"production"' },
};

async function main() {
  if (watch) {
    const extCtx = await esbuild.context(extensionConfig);
    const webCtx = await esbuild.context(webviewConfig);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    console.log("[rAPI] watching for changes…");
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log("[rAPI] build complete");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

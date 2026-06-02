#!/usr/bin/env node
/**
 * Local dev server for the wishlist app.
 *
 * Handles the two things the simple one-liner can't:
 *   /hub-sdk.js  → served from the hub repo's public directory
 *   /*           → served from src/
 *
 * Hub SDK path is resolved from HUB_SDK_PATH env var, or falls back to the
 * standard sibling-repo layout: ../../chickadeebandit/packages/hub/public/hub-sdk.js
 *
 * Usage:
 *   node dev.mjs              # http://localhost:3001
 *   PORT=3002 node dev.mjs
 *   HUB_SDK_PATH=/abs/path/to/hub-sdk.js node dev.mjs
 */

import http from "http";
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT      = parseInt(process.env.PORT ?? "3001", 10);

const HUB_SDK_PATH = process.env.HUB_SDK_PATH
  ?? path.resolve(__dirname, "../../chickadeebandit/packages/hub/public/hub-sdk.js");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
};

function mime(filepath) {
  return MIME[path.extname(filepath).toLowerCase()] ?? "application/octet-stream";
}

function serve(res, filepath, status = 200) {
  try {
    const body = fs.readFileSync(filepath);
    res.writeHead(status, { "Content-Type": mime(filepath) });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`Not found: ${filepath}`);
  }
}

const APP_BASE = "/run/wishlist/";

http.createServer((req, res) => {
  const url = req.url.split("?")[0];

  if (url === "/hub-sdk.js") {
    serve(res, HUB_SDK_PATH);
    return;
  }

  // Strip the base href prefix so relative imports resolve under src/
  const stripped = url.startsWith(APP_BASE) ? url.slice(APP_BASE.length) : url.replace(/^\//, "");
  const relative = stripped === "" ? "index.html" : stripped;
  serve(res, path.join(__dirname, "src", relative));
}).listen(PORT, () => {
  console.log(`Dev server: http://localhost:${PORT}`);
  console.log(`hub-sdk.js: ${HUB_SDK_PATH}`);
  if (!fs.existsSync(HUB_SDK_PATH)) {
    console.warn(`\nWARN: hub-sdk.js not found at the path above.`);
    console.warn(`      Set HUB_SDK_PATH env var to point to the hub repo's public/hub-sdk.js.\n`);
  }
});

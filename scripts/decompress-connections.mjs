#!/usr/bin/env node
// Only data/connections.json.gz is committed (see "Untrack regeneratable
// data files" in git history) - the app imports the plain .json, so this
// regenerates it from the tracked .gz. Run before building/starting the
// mobile app if data/connections.json is missing.
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gzPath = path.join(repoRoot, "data", "connections.json.gz");
const jsonPath = path.join(repoRoot, "data", "connections.json");

if (existsSync(jsonPath)) {
  console.log("data/connections.json already present, skipping decompression.");
} else {
  const compressed = readFileSync(gzPath);
  writeFileSync(jsonPath, gunzipSync(compressed));
  console.log(`Decompressed ${gzPath} -> ${jsonPath}`);
}

/**
 * Patch script for browser-whisper onnxruntime Emscripten WebGPU binding.
 *
 * Prevents unhandled "TypeError: Cannot read properties of undefined (reading 'destroy')"
 * when wgpuBufferRelease (db) or wgpuDeviceRelease (yb) is called for uninitialized
 * or already-released WebGPU handles.
 *
 * Strict validation: Throws an error if any expected code pattern stops matching.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetFile = path.resolve(__dirname, "../node_modules/browser-whisper/dist/index.js");

if (!fs.existsSync(targetFile)) {
  console.log("[patch-browser-whisper] node_modules/browser-whisper not found, skipping.");
  process.exit(0);
}

let code = fs.readFileSync(targetFile, "utf8");

const patterns = [
  {
    name: "f.destroy() in db(u)",
    unpatched: "f.destroy();\n  }\n  function hb",
    patched: "(f && typeof f.destroy === 'function' && f.destroy());\n  }\n  function hb",
  },
  {
    name: "u.destroy() in yb(u)",
    unpatched: "(u = K(u)).onuncapturederror = null, u.destroy();",
    patched: "(u = K(u)) && (u.onuncapturederror = null, typeof u.destroy === 'function' && u.destroy());",
  },
  {
    name: "f.unmap() in pb(u)",
    unpatched: "delete cr[u], f.unmap();",
    patched: "delete cr[u], (f && typeof f.unmap === 'function' && f.unmap());",
  },
];

let modified = false;

for (const pattern of patterns) {
  if (code.includes(pattern.patched)) {
    // Already patched in previous run
    continue;
  }

  if (code.includes(pattern.unpatched)) {
    code = code.replace(pattern.unpatched, pattern.patched);
    modified = true;
    console.log(`[patch-browser-whisper] Patched ${pattern.name}`);
  } else {
    throw new Error(
      `[patch-browser-whisper] Expected code pattern for "${pattern.name}" did not match in ${targetFile}. ` +
      `Ensure browser-whisper is pinned to exact version 2.0.0.`
    );
  }
}

if (modified) {
  fs.writeFileSync(targetFile, code, "utf8");
  console.log("[patch-browser-whisper] Successfully patched browser-whisper.");
} else {
  console.log("[patch-browser-whisper] browser-whisper is already up-to-date and patched.");
}

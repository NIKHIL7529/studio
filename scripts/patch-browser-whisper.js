/**
 * Patch script for browser-whisper onnxruntime Emscripten WebGPU binding.
 *
 * Prevents unhandled "TypeError: Cannot read properties of undefined (reading 'destroy')"
 * when wgpuBufferRelease (db) or wgpuDeviceRelease (yb) is called for uninitialized
 * or already-released WebGPU handles.
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
let patched = false;

// 1. Guard f.destroy() in db(u)
if (code.includes("f.destroy();\n  }\n  function hb")) {
  code = code.replace(
    "f.destroy();\n  }\n  function hb",
    "(f && typeof f.destroy === 'function' && f.destroy());\n  }\n  function hb"
  );
  patched = true;
  console.log("[patch-browser-whisper] Patched f.destroy() in db(u)");
}

// 2. Guard u.destroy() in yb(u)
if (code.includes("(u = K(u)).onuncapturederror = null, u.destroy();")) {
  code = code.replace(
    "(u = K(u)).onuncapturederror = null, u.destroy();",
    "(u = K(u)) && (u.onuncapturederror = null, typeof u.destroy === 'function' && u.destroy());"
  );
  patched = true;
  console.log("[patch-browser-whisper] Patched u.destroy() in yb(u)");
}

// 3. Guard f.unmap() in pb(u)
if (code.includes("delete cr[u], f.unmap();")) {
  code = code.replace(
    "delete cr[u], f.unmap();",
    "delete cr[u], (f && typeof f.unmap === 'function' && f.unmap());"
  );
  patched = true;
  console.log("[patch-browser-whisper] Patched f.unmap() in pb(u)");
}

if (patched) {
  fs.writeFileSync(targetFile, code, "utf8");
  console.log("[patch-browser-whisper] Successfully patched browser-whisper.");
} else {
  console.log("[patch-browser-whisper] browser-whisper is already patched or patterns did not match.");
}

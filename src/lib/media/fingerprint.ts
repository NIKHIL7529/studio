/**
 * Fast, bounded media fingerprinting for Content Studio (Phase 6).
 *
 * Rules:
 * - Computes a deterministic SHA-256 fingerprint from head/tail slices and file metadata.
 * - Never loads the entire video into memory; bounded to at most 128 KB of slice data.
 * - Used during media import and relinking to verify content identity without solely relying on filename.
 */

const CHUNK_SIZE = 64 * 1024; // 64 KB head and tail sample

/**
 * Computes a fast hex-encoded SHA-256 fingerprint for a File or Blob.
 */
export async function computeMediaFingerprint(file: File | Blob): Promise<string> {
  const size = file.size;
  const type = file.type || "";

  // Collect sample buffers
  const chunks: ArrayBuffer[] = [];

  if (size <= CHUNK_SIZE * 2) {
    // File is small enough to sample completely
    const buf = await file.arrayBuffer();
    chunks.push(buf);
  } else {
    // Sample head 64KB
    const headSlice = file.slice(0, CHUNK_SIZE);
    chunks.push(await headSlice.arrayBuffer());

    // Sample tail 64KB
    const tailSlice = file.slice(size - CHUNK_SIZE, size);
    chunks.push(await tailSlice.arrayBuffer());
  }

  // Combine slices with metadata length prefix
  const metaString = `size:${size}|type:${type}`;
  const metaBuffer = new TextEncoder().encode(metaString);

  const totalLength = metaBuffer.byteLength + chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const combined = new Uint8Array(totalLength);

  combined.set(metaBuffer, 0);
  let offset = metaBuffer.byteLength;
  for (const chunk of chunks) {
    combined.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  // Hash with crypto.subtle if available
  if (typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.digest === "function") {
    const digestBuffer = await crypto.subtle.digest("SHA-256", combined);
    const hashArray = Array.from(new Uint8Array(digestBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Fallback FNV-1a 64-bit hex hash if crypto.subtle is unavailable
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < combined.length; i++) {
    h1 = Math.imul(h1 ^ combined[i], 0x01000193);
    h2 = Math.imul(h2 ^ combined[i], 0x01000197);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

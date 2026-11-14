/**
 * Media input construction and lifecycle management using Mediabunny.
 *
 * Rules:
 * - Uses BlobSource to read directly from a File or Blob.
 * - Does NOT read the full file into an ArrayBuffer or base64 string.
 * - Every Input instance created must be cleanly disposed after use.
 */

import { Input, BlobSource, ALL_FORMATS } from "mediabunny";

/**
 * Creates a Mediabunny Input backed by a File or Blob source.
 * Streams data with bounded internal buffering without reading the entire file into memory.
 */
export function createMediaInput(source: Blob | File): Input<BlobSource> {
  if (!source) {
    throw new Error("Cannot create media input: source is null or undefined.");
  }

  const blobSource = new BlobSource(source);
  return new Input({
    formats: ALL_FORMATS,
    source: blobSource,
  });
}

/**
 * Safely disposes a Mediabunny Input instance, canceling pending reads
 * and freeing underlying resources.
 */
export function disposeMediaInput(input: Input | null | undefined): void {
  if (!input) return;
  try {
    if (!input.disposed) {
      input.dispose();
    }
  } catch (err) {
    console.warn("Error while disposing media input:", err);
  }
}


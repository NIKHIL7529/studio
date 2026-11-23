import test from "node:test";
import assert from "node:assert/strict";
import { inferMediaCategory, compareRelinkMetadata } from "../src/lib/mediaImport.ts";
import type { ProjectAsset } from "../src/types/project.ts";

test("inferMediaCategory accurately classifies video and audio formats", () => {
  // By MIME type
  assert.equal(inferMediaCategory("file", "video/mp4"), "video");
  assert.equal(inferMediaCategory("file", "video/webm"), "video");
  assert.equal(inferMediaCategory("file", "audio/mpeg"), "audio");
  assert.equal(inferMediaCategory("file", "audio/wav"), "audio");

  // By extension
  assert.equal(inferMediaCategory("clip.mp4"), "video");
  assert.equal(inferMediaCategory("clip.mov"), "video");
  assert.equal(inferMediaCategory("clip.webm"), "video");
  assert.equal(inferMediaCategory("clip.mkv"), "video");
  assert.equal(inferMediaCategory("song.mp3"), "audio");
  assert.equal(inferMediaCategory("voiceover.wav"), "audio");
  assert.equal(inferMediaCategory("podcast.m4a"), "audio");
  assert.equal(inferMediaCategory("audio.aac"), "audio");

  // Supported Images
  assert.equal(inferMediaCategory("image.png"), "image");
  assert.equal(inferMediaCategory("photo.jpg"), "image");
  assert.equal(inferMediaCategory("picture.jpeg"), "image");
  assert.equal(inferMediaCategory("logo.webp"), "image");

  // Disallowed image formats (restricted to avoid canvas issues)
  assert.equal(inferMediaCategory("graphic.svg"), "unknown");
  assert.equal(inferMediaCategory("anim.gif"), "unknown");
  assert.equal(inferMediaCategory("bitmap.bmp"), "unknown");
  assert.equal(inferMediaCategory("modern.avif"), "unknown");
  assert.equal(inferMediaCategory("icon.svg", "image/svg+xml"), "unknown");

  // Unknown
  assert.equal(inferMediaCategory("document.pdf"), "unknown");
});

test("compareRelinkMetadata flags differences in filename, size, and date", () => {
  const asset: ProjectAsset = {
    id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    name: "interview.mp4",
    kind: "video",
    mediaType: "video",
    mimeType: "video/mp4",
    size: 204800,
    lastModified: 1700000000000,
    handleRefId: "ref-1",
  };

  // Identical file
  const identicalFile = {
    name: "interview.mp4",
    size: 204800,
    lastModified: 1700000000000,
  } as File;

  const res1 = compareRelinkMetadata(asset, identicalFile);
  assert.equal(res1.match, true);
  assert.equal(res1.nameDiffers, false);
  assert.equal(res1.sizeDiffers, false);
  assert.equal(res1.dateDiffers, false);

  // Different filename
  const renamedFile = {
    name: "interview-edited.mp4",
    size: 204800,
    lastModified: 1700000000000,
  } as File;

  const res2 = compareRelinkMetadata(asset, renamedFile);
  assert.equal(res2.match, false);
  assert.equal(res2.nameDiffers, true);
  assert.equal(res2.sizeDiffers, false);

  // Different size and date
  const modifiedFile = {
    name: "interview.mp4",
    size: 300000,
    lastModified: 1700005000000,
  } as File;

  const res3 = compareRelinkMetadata(asset, modifiedFile);
  assert.equal(res3.match, false);
  assert.equal(res3.sizeDiffers, true);
  assert.equal(res3.dateDiffers, true);
});

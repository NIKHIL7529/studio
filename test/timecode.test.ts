import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  secondsToFrames,
  framesToSeconds,
  formatTimecode,
  parseTimecode,
  stepFrames,
  snapToFrame,
} from "../src/lib/timeline/timecode.ts";

describe("Timecode and Frame-Accurate Calculations", () => {
  test("secondsToFrames and framesToSeconds at 30 fps", () => {
    assert.equal(secondsToFrames(0, 30), 0);
    assert.equal(secondsToFrames(1.0, 30), 30);
    assert.equal(secondsToFrames(1.5, 30), 45);
    assert.equal(secondsToFrames(0.033333, 30), 1);

    assert.equal(framesToSeconds(0, 30), 0);
    assert.equal(framesToSeconds(30, 30), 1.0);
    assert.equal(framesToSeconds(45, 30), 1.5);
  });

  test("secondsToFrames handles negative and non-finite inputs cleanly", () => {
    assert.equal(secondsToFrames(-5, 30), 0);
    assert.equal(secondsToFrames(NaN, 30), 0);
    assert.equal(secondsToFrames(Infinity, 30), 0);
  });

  test("snapToFrame quantizes to discrete frame intervals", () => {
    const snapped = snapToFrame(1.015, 30);
    assert.equal(snapped, 1.0); // 1.015 * 30 = 30.45 -> frame 30 -> 1.0s
    const snappedNext = snapToFrame(1.02, 30);
    assert.equal(snappedNext, 31 / 30); // 1.02 * 30 = 30.6 -> frame 31
  });

  test("stepFrames advances or rewinds exactly by frame count", () => {
    const t0 = 1.0;
    const t1 = stepFrames(t0, 1, 30);
    assert.equal(t1, 31 / 30);

    const tMinus = stepFrames(t0, -2, 30);
    assert.equal(tMinus, 28 / 30);

    const clamped = stepFrames(t0, -100, 30);
    assert.equal(clamped, 0);
  });

  test("formatTimecode formats standard SMPTE strings", () => {
    assert.equal(formatTimecode(0, 30), "00:00:00:00");
    assert.equal(formatTimecode(1.0, 30), "00:00:01:00");
    assert.equal(formatTimecode(65.5, 30), "00:01:05:15");
    assert.equal(formatTimecode(3661.0, 30), "01:01:01:00");
  });

  test("parseTimecode parses various standard inputs", () => {
    assert.equal(parseTimecode("00:00:00:00", 30), 0);
    assert.equal(parseTimecode("00:00:01:00", 30), 1.0);
    assert.equal(parseTimecode("00:01:05:15", 30), 65.5);
    assert.equal(parseTimecode("01:00:00:00", 30), 3600);
    assert.equal(parseTimecode("10:15", 30), 10.5); // SS:FF (10s + 15 frames @ 30fps = 10.5s)
    assert.equal(parseTimecode("12.5s", 30), 12.5);
    assert.equal(parseTimecode("invalid", 30), null);
    assert.equal(parseTimecode("", 30), null);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TRANSITION_CATALOG,
  getTransitionDefinition,
  filterTransitions,
  getTransitionTimeWindow,
  getTransitionProgress,
} from "../src/lib/transitions/transitionCatalog.ts";
import { renderTransition } from "../src/lib/transitions/renderers.ts";
import type { TimelineTransition } from "../src/types/timeline.ts";

describe("Transitions Catalog & Evaluation", () => {
  it("includes all required transition families and definitions", () => {
    assert.ok(TRANSITION_CATALOG.length >= 25, "Expected comprehensive library of at least 25 transitions");

    const families = new Set(TRANSITION_CATALOG.map((t) => t.family));
    assert.ok(families.has("dissolve"), "Must include dissolve family");
    assert.ok(families.has("wipe"), "Must include wipe family");
    assert.ok(families.has("movement"), "Must include movement family");
    assert.ok(families.has("stylized"), "Must include stylized family");
    assert.ok(families.has("audio"), "Must include audio family");
  });

  it("filters transitions by family and search query", () => {
    const dissolves = filterTransitions("dissolve");
    assert.ok(dissolves.length >= 4);
    assert.ok(dissolves.every((t) => t.family === "dissolve"));

    const wipes = filterTransitions("wipe");
    assert.ok(wipes.length >= 8);

    const glitchResults = filterTransitions("all", "glitch");
    assert.ok(glitchResults.length >= 1);
    assert.equal(glitchResults[0].type, "glitch");
  });

  it("calculates transition time window accurately for all alignments", () => {
    const baseTransition: TimelineTransition = {
      id: "tr-1",
      type: "cross_dissolve",
      family: "dissolve",
      trackId: "track-1",
      editPoint: 10,
      duration: 2,
      alignment: "center",
      params: {},
    };

    // Center alignment: [10 - 1, 10 + 1] = [9, 11]
    const centerWin = getTransitionTimeWindow(baseTransition);
    assert.equal(centerWin.start, 9);
    assert.equal(centerWin.end, 11);

    // Start alignment: [10, 10 + 2] = [10, 12]
    const startWin = getTransitionTimeWindow({ ...baseTransition, alignment: "start" });
    assert.equal(startWin.start, 10);
    assert.equal(startWin.end, 12);

    // End alignment: [10 - 2, 10] = [8, 10]
    const endWin = getTransitionTimeWindow({ ...baseTransition, alignment: "end" });
    assert.equal(endWin.start, 8);
    assert.equal(endWin.end, 10);
  });

  it("calculates normalized transition progress [0, 1] with easing curves", () => {
    const trans: TimelineTransition = {
      id: "tr-2",
      type: "cross_dissolve",
      family: "dissolve",
      trackId: "track-1",
      editPoint: 5,
      duration: 2,
      alignment: "center",
      params: { easing: "linear" },
    };

    // Window: [4, 6]
    assert.equal(getTransitionProgress(trans, 3.5), 0);
    assert.equal(getTransitionProgress(trans, 4.0), 0);
    assert.equal(getTransitionProgress(trans, 5.0), 0.5);
    assert.equal(getTransitionProgress(trans, 6.0), 1.0);
    assert.equal(getTransitionProgress(trans, 7.0), 1.0);

    // Ease-in-out easing
    const easedTrans: TimelineTransition = {
      ...trans,
      params: { easing: "ease-in-out" },
    };
    const pMid = getTransitionProgress(easedTrans, 5.0);
    assert.equal(pMid, 0.5, "Midpoint of ease-in-out should be 0.5");

    const pQuarter = getTransitionProgress(easedTrans, 4.5);
    assert.ok(pQuarter < 0.25, "Quarter point should be eased slower than linear");
  });

  it("executes renderTransition deterministically without throwing", () => {
    // Mock canvas context
    const calls: string[] = [];
    const mockCtx = {
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      fillRect: () => calls.push("fillRect"),
      drawImage: () => calls.push("drawImage"),
      beginPath: () => calls.push("beginPath"),
      rect: () => calls.push("rect"),
      clip: () => calls.push("clip"),
      translate: () => calls.push("translate"),
      scale: () => calls.push("scale"),
      rotate: () => calls.push("rotate"),
      getImageData: () => ({ data: new Uint8ClampedArray(100 * 100 * 4) }),
      putImageData: () => calls.push("putImageData"),
      globalAlpha: 1.0,
      fillStyle: "#000000",
    } as any;

    let fromDrawn = false;
    let toDrawn = false;
    const drawFrom = () => { fromDrawn = true; };
    const drawTo = () => { toDrawn = true; };

    const trans: TimelineTransition = {
      id: "tr-3",
      type: "cross_dissolve",
      family: "dissolve",
      trackId: "track-1",
      editPoint: 5,
      duration: 1,
      alignment: "center",
    };

    renderTransition(mockCtx, 1920, 1080, trans, 0.4, drawFrom, drawTo);
    assert.ok(fromDrawn, "Outgoing frame drawer must be called");
    assert.ok(toDrawn, "Incoming frame drawer must be called");
  });
});

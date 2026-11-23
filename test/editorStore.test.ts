import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../src/store/editorStore.ts";

describe("EditorStore (Zustand)", () => {
  beforeEach(() => {
    useEditorStore.getState().resetEditorUiState();
  });

  it("initializes with sensible default state", () => {
    const state = useEditorStore.getState();
    assert.equal(state.playheadTime, 0);
    assert.equal(state.isPlaying, false);
    assert.equal(state.isScrubbing, false);
    assert.equal(state.zoomPxPerSec, 100);
    assert.equal(state.scrollLeft, 0);
    assert.equal(state.snapEnabled, true);
    assert.equal(state.activeTool, "select");
    assert.deepEqual(state.selectedClipIds, []);
    assert.equal(state.selectedOverlayId, null);
    assert.equal(state.selectedTrackId, null);
    assert.equal(state.selectedMarkerId, null);
    assert.equal(state.activeLeftTab, "media");
    assert.equal(state.activeMonitorMode, "dual");
    assert.equal(state.dragPreview, null);
  });

  it("updates and bounds playheadTime correctly", () => {
    const store = useEditorStore.getState();
    store.setPlayheadTime(12.5);
    assert.equal(useEditorStore.getState().playheadTime, 12.5);

    store.setPlayheadTime(-5);
    assert.equal(useEditorStore.getState().playheadTime, 0);
  });

  it("clamps zoomPxPerSec between 20 and 500", () => {
    const store = useEditorStore.getState();
    store.setZoomPxPerSec(10);
    assert.equal(useEditorStore.getState().zoomPxPerSec, 20);

    store.setZoomPxPerSec(600);
    assert.equal(useEditorStore.getState().zoomPxPerSec, 500);

    store.setZoomPxPerSec(250);
    assert.equal(useEditorStore.getState().zoomPxPerSec, 250);
  });

  it("toggles snap correctly", () => {
    const store = useEditorStore.getState();
    assert.equal(useEditorStore.getState().snapEnabled, true);

    store.toggleSnap();
    assert.equal(useEditorStore.getState().snapEnabled, false);

    store.setSnapEnabled(true);
    assert.equal(useEditorStore.getState().snapEnabled, true);
  });

  it("switches activeTool, left tab, and monitor mode", () => {
    const store = useEditorStore.getState();
    store.setActiveTool("razor");
    assert.equal(useEditorStore.getState().activeTool, "razor");

    store.setActiveLeftTab("captions");
    assert.equal(useEditorStore.getState().activeLeftTab, "captions");

    store.setActiveMonitorMode("program");
    assert.equal(useEditorStore.getState().activeMonitorMode, "program");
  });

  it("manages selection isolation across clips, overlays, and markers", () => {
    const store = useEditorStore.getState();

    // Select single clip
    store.selectSingleClip("clip-1");
    assert.deepEqual(useEditorStore.getState().selectedClipIds, ["clip-1"]);
    assert.equal(useEditorStore.getState().selectedOverlayId, null);
    assert.equal(useEditorStore.getState().selectedMarkerId, null);

    // Select overlay -> clears clips and markers
    store.selectOverlay("overlay-1");
    assert.deepEqual(useEditorStore.getState().selectedClipIds, []);
    assert.equal(useEditorStore.getState().selectedOverlayId, "overlay-1");
    assert.equal(useEditorStore.getState().selectedMarkerId, null);

    // Select marker -> clears overlays and clips
    store.setSelectedMarkerId("marker-1");
    assert.deepEqual(useEditorStore.getState().selectedClipIds, []);
    assert.equal(useEditorStore.getState().selectedOverlayId, null);
    assert.equal(useEditorStore.getState().selectedMarkerId, "marker-1");

    // Clear selection
    store.clearSelection();
    assert.deepEqual(useEditorStore.getState().selectedClipIds, []);
    assert.equal(useEditorStore.getState().selectedOverlayId, null);
    assert.equal(useEditorStore.getState().selectedMarkerId, null);
    assert.equal(useEditorStore.getState().selectedTrackId, null);
  });

  it("handles drag preview state", () => {
    const store = useEditorStore.getState();
    store.setDragPreview({ clipId: "c1", deltaX: 50, deltaTime: 0.5 });
    assert.deepEqual(useEditorStore.getState().dragPreview, {
      clipId: "c1",
      deltaX: 50,
      deltaTime: 0.5,
    });

    store.setDragPreview(null);
    assert.equal(useEditorStore.getState().dragPreview, null);
  });

  it("resets all editor UI state back to initial defaults", () => {
    const store = useEditorStore.getState();
    store.setPlayheadTime(45);
    store.setIsPlaying(true);
    store.setActiveTool("text");
    store.selectSingleClip("clip-x");
    store.setActiveLeftTab("transitions");

    store.resetEditorUiState();
    const state = useEditorStore.getState();
    assert.equal(state.playheadTime, 0);
    assert.equal(state.isPlaying, false);
    assert.equal(state.activeTool, "select");
    assert.deepEqual(state.selectedClipIds, []);
    assert.equal(state.activeLeftTab, "media");
  });
});

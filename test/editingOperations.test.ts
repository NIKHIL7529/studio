import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createTimeline, createClip } from "../src/lib/timeline/model.ts";
import {
  rippleTrimStart,
  rippleTrimEnd,
  rollEdit,
  slipEdit,
  slideEdit,
  razorSplitAtPlayhead,
  liftClips,
  rippleDeleteClips,
  closeGap,
  insertEdit,
  overwriteEdit,
  linkClips,
  unlinkClip,
  groupClips,
  ungroupClips,
  addTrack,
  removeTrack,
  reorderTrack,
  toggleTrackLock,
  toggleTrackMute,
  toggleTrackSolo,
  toggleTrackHidden,
  toggleTrackSyncLock,
  renameTrack,
  addMarker,
  updateMarker,
  removeMarker,
  findNearestMarker,
  copyClips,
  pasteClips,
} from "../src/lib/timeline/editingOperations.ts";
import type { TimelineDocument } from "../src/types/timeline.ts";

function createTestTimeline(): {
  timeline: TimelineDocument;
  videoTrackId: string;
  audioTrackId: string;
  clip1Id: string;
  clip2Id: string;
  clip3Id: string;
} {
  const base = createTimeline();
  const vTrack = base.tracks.find((t) => t.type === "video")!;
  const aTrack = base.tracks.find((t) => t.type === "audio")!;

  const asset1 = crypto.randomUUID();
  const asset2 = crypto.randomUUID();
  const asset3 = crypto.randomUUID();

  // Clip 1: [0, 5) source [0, 5)
  const c1 = createClip(asset1, vTrack.id, 0, 0, 5);
  // Clip 2: [5, 10) source [10, 15)
  const c2 = createClip(asset2, vTrack.id, 5, 10, 15);
  // Clip 3: [12, 16) source [0, 4)
  const c3 = createClip(asset3, vTrack.id, 12, 0, 4);

  const populated: TimelineDocument = {
    ...base,
    tracks: [
      {
        ...vTrack,
        syncLocked: true,
        clips: [c1, c2, c3],
      },
      {
        ...aTrack,
        syncLocked: true,
        clips: [],
      },
    ],
  };

  return {
    timeline: populated,
    videoTrackId: vTrack.id,
    audioTrackId: aTrack.id,
    clip1Id: c1.id,
    clip2Id: c2.id,
    clip3Id: c3.id,
  };
}

describe("Advanced NLE Timeline Editing Operations", () => {
  describe("Ripple Trim", () => {
    test("rippleTrimStart trims in-point and ripples downstream clips", () => {
      const { timeline, clip1Id, clip2Id, clip3Id } = createTestTimeline();

      // Trim clip 1 in-point from 0 to 2 (clip gets 2 seconds shorter)
      const updated = rippleTrimStart(timeline, clip1Id, 2);
      const vTrack = updated.tracks[0];

      const c1 = vTrack.clips.find((c) => c.id === clip1Id)!;
      const c2 = vTrack.clips.find((c) => c.id === clip2Id)!;
      const c3 = vTrack.clips.find((c) => c.id === clip3Id)!;

      assert.equal(c1.sourceIn, 2);
      assert.equal(c1.sourceOut, 5);
      assert.equal(c1.startTime, 0); // start remains 0, duration is 3s

      // c2 was at 5s, shifted backward by 2s -> now starts at 3s
      assert.equal(c2.startTime, 3);
      // c3 was at 12s, shifted backward by 2s -> now starts at 10s
      assert.equal(c3.startTime, 10);
    });

    test("rippleTrimEnd trims out-point and ripples downstream clips", () => {
      const { timeline, clip1Id, clip2Id, clip3Id } = createTestTimeline();

      // Trim clip 1 out-point from 5 to 7 (clip gets 2 seconds longer)
      const updated = rippleTrimEnd(timeline, clip1Id, 7);
      const vTrack = updated.tracks[0];

      const c1 = vTrack.clips.find((c) => c.id === clip1Id)!;
      const c2 = vTrack.clips.find((c) => c.id === clip2Id)!;
      const c3 = vTrack.clips.find((c) => c.id === clip3Id)!;

      assert.equal(c1.sourceIn, 0);
      assert.equal(c1.sourceOut, 7);
      // c2 was at 5s, shifted forward by 2s -> now starts at 7s
      assert.equal(c2.startTime, 7);
      // c3 was at 12s, shifted forward by 2s -> now starts at 14s
      assert.equal(c3.startTime, 14);
    });
  });

  describe("Roll Edit", () => {
    test("rollEdit adjusts edit point between adjacent clips preserving total duration", () => {
      const { timeline, clip1Id, clip2Id } = createTestTimeline();

      // Clip 1 is [0, 5), Clip 2 is [5, 10). Shift edit point by +1 second.
      const updated = rollEdit(timeline, clip1Id, clip2Id, 1);
      const vTrack = updated.tracks[0];

      const c1 = vTrack.clips.find((c) => c.id === clip1Id)!;
      const c2 = vTrack.clips.find((c) => c.id === clip2Id)!;

      // c1: sourceIn 0, sourceOut 6 (grew by 1s)
      assert.equal(c1.sourceOut, 6);
      // c2: sourceIn was 10, now 11 (shrank by 1s), startTime moved from 5 to 6
      assert.equal(c2.sourceIn, 11);
      assert.equal(c2.startTime, 6);
      assert.equal(c2.sourceOut, 15);

      // Total duration of both clips remains 10s
      const totalDuration = (c1.sourceOut - c1.sourceIn) + (c2.sourceOut - c2.sourceIn);
      assert.equal(totalDuration, 10);
    });
  });

  describe("Slip Edit", () => {
    test("slipEdit shifts source media window without altering timeline position or duration", () => {
      const { timeline, clip2Id } = createTestTimeline();

      // Clip 2 is at startTime 5, duration 5s, source [10, 15). Slip forward by 2s.
      const updated = slipEdit(timeline, clip2Id, 2, 20);
      const vTrack = updated.tracks[0];

      const c2 = vTrack.clips.find((c) => c.id === clip2Id)!;
      assert.equal(c2.startTime, 5);
      assert.equal(c2.sourceIn, 12);
      assert.equal(c2.sourceOut, 17);
    });
  });

  describe("Slide Edit", () => {
    test("slideEdit moves clip adjusting adjacent edit boundaries", () => {
      const { timeline, clip1Id, clip2Id, clip3Id } = createTestTimeline();

      // Put clip 3 adjacent to clip 2 at 10s:
      const adjTimeline: TimelineDocument = {
        ...timeline,
        tracks: [
          {
            ...timeline.tracks[0],
            clips: timeline.tracks[0].clips.map((c) => (c.id === clip3Id ? { ...c, startTime: 10 } : c)),
          },
          timeline.tracks[1],
        ],
      };

      // Slide clip 2 by +1s (moves from startTime 5 to 6, extending clip 1 and shortening clip 3)
      const updated = slideEdit(adjTimeline, clip2Id, 1, clip1Id, clip3Id);
      const vTrack = updated.tracks[0];

      const c1 = vTrack.clips.find((c) => c.id === clip1Id)!;
      const c2 = vTrack.clips.find((c) => c.id === clip2Id)!;
      const c3 = vTrack.clips.find((c) => c.id === clip3Id)!;

      assert.equal(c1.sourceOut, 6); // clip 1 extended by 1s
      assert.equal(c2.startTime, 6); // clip 2 moved to 6s
      assert.equal(c3.startTime, 11); // clip 3 starts at 11s
      assert.equal(c3.sourceIn, 1); // clip 3 in-point trimmed by 1s
    });
  });

  describe("Razor Split", () => {
    test("razorSplitAtPlayhead cuts clips under playhead", () => {
      const { timeline, clip1Id } = createTestTimeline();

      // Split clip 1 (which spans 0 to 5) at 2.5s
      const updated = razorSplitAtPlayhead(timeline, 2.5);
      const vTrack = updated.tracks[0];

      assert.equal(vTrack.clips.length, 4);
      const c1 = vTrack.clips.find((c) => c.id === clip1Id)!;
      assert.equal(c1.startTime, 0);
      assert.equal(c1.sourceOut, 2.5);

      const splitPiece = vTrack.clips.find((c) => c.startTime === 2.5)!;
      assert.ok(splitPiece);
      assert.equal(splitPiece.sourceIn, 2.5);
      assert.equal(splitPiece.sourceOut, 5);
    });
  });

  describe("Lift and Ripple Delete", () => {
    test("liftClips leaves empty gap", () => {
      const { timeline, clip2Id } = createTestTimeline();

      const updated = liftClips(timeline, [clip2Id]);
      const vTrack = updated.tracks[0];

      assert.equal(vTrack.clips.length, 2);
      // Clip 3 remains at 12s (gap preserved)
      const c3 = vTrack.clips.find((c) => c.sourceOut === 4)!;
      assert.equal(c3.startTime, 12);
    });

    test("rippleDeleteClips removes clip and closes gap by shifting downstream clips", () => {
      const { timeline, clip2Id, clip3Id } = createTestTimeline();

      // Clip 2 is 5s long (from 5s to 10s). Clip 3 is at 12s.
      const updated = rippleDeleteClips(timeline, [clip2Id], true);
      const vTrack = updated.tracks[0];

      assert.equal(vTrack.clips.length, 2);
      const c3 = vTrack.clips.find((c) => c.id === clip3Id)!;
      // c3 was at 12s, shifted back by 5s -> 7s
      assert.equal(c3.startTime, 7);
    });
  });

  describe("Close Gap", () => {
    test("closeGap pulls downstream clips leftward to eliminate empty space", () => {
      const { timeline, clip3Id } = createTestTimeline();

      // Gap exists between clip 2 (ends at 10s) and clip 3 (starts at 12s)
      const updated = closeGap(timeline, timeline.tracks[0].id, 10, true);
      const vTrack = updated.tracks[0];

      const c3 = vTrack.clips.find((c) => c.id === clip3Id)!;
      assert.equal(c3.startTime, 10);
    });
  });

  describe("Insert & Overwrite Edits", () => {
    test("insertEdit inserts clip and ripples downstream clips", () => {
      const { timeline, videoTrackId, clip2Id, clip3Id } = createTestTimeline();

      const newAsset = crypto.randomUUID();
      // Insert 3-second clip at 6s (splits clip 2 which spans 5 to 10)
      const updated = insertEdit(timeline, videoTrackId, newAsset, 0, 3, 6, true);
      const vTrack = updated.tracks[0];

      // New clip inserted at 6s with duration 3s (6 to 9)
      const inserted = vTrack.clips.find((c) => c.assetId === newAsset)!;
      assert.ok(inserted);
      assert.equal(inserted.startTime, 6);
      assert.equal(inserted.sourceOut - inserted.sourceIn, 3);

      // Clip 3 was at 12s -> now shifted by 3s to 15s
      const c3 = vTrack.clips.find((c) => c.id === clip3Id)!;
      assert.equal(c3.startTime, 15);
    });

    test("overwriteEdit places clip without shifting downstream clips", () => {
      const { timeline, videoTrackId, clip3Id } = createTestTimeline();

      const newAsset = crypto.randomUUID();
      // Overwrite 2-second clip at 4s to 6s (overlaps end of clip 1 and start of clip 2)
      const updated = overwriteEdit(timeline, videoTrackId, newAsset, 0, 2, 4);
      const vTrack = updated.tracks[0];

      const inserted = vTrack.clips.find((c) => c.assetId === newAsset)!;
      assert.equal(inserted.startTime, 4);
      assert.equal(inserted.sourceOut - inserted.sourceIn, 2);

      // Downstream clip 3 remains at exactly 12s!
      const c3 = vTrack.clips.find((c) => c.id === clip3Id)!;
      assert.equal(c3.startTime, 12);
    });
  });

  describe("Linking and Grouping", () => {
    test("linkClips and unlinkClip manage bidirectional link ID", () => {
      const { timeline, clip1Id, clip2Id } = createTestTimeline();

      const linked = linkClips(timeline, clip1Id, clip2Id);
      const c1 = linked.tracks[0].clips.find((c) => c.id === clip1Id)!;
      const c2 = linked.tracks[0].clips.find((c) => c.id === clip2Id)!;

      assert.equal(c1.linkedClipId, clip2Id);
      assert.equal(c2.linkedClipId, clip1Id);

      const unlinked = unlinkClip(linked, clip1Id);
      const u1 = unlinked.tracks[0].clips.find((c) => c.id === clip1Id)!;
      const u2 = unlinked.tracks[0].clips.find((c) => c.id === clip2Id)!;

      assert.equal(u1.linkedClipId, undefined);
      assert.equal(u2.linkedClipId, undefined);
    });

    test("groupClips and ungroupClips manage shared group ID", () => {
      const { timeline, clip1Id, clip2Id } = createTestTimeline();

      const grouped = groupClips(timeline, [clip1Id, clip2Id]);
      const c1 = grouped.tracks[0].clips.find((c) => c.id === clip1Id)!;
      const c2 = grouped.tracks[0].clips.find((c) => c.id === clip2Id)!;

      assert.ok(c1.groupId);
      assert.equal(c1.groupId, c2.groupId);

      const ungrouped = ungroupClips(grouped, [clip1Id, clip2Id]);
      const u1 = ungrouped.tracks[0].clips.find((c) => c.id === clip1Id)!;
      assert.equal(u1.groupId, undefined);
    });
  });

  describe("Track Management", () => {
    test("addTrack, removeTrack, reorderTrack and toggle functions", () => {
      const { timeline, videoTrackId } = createTestTimeline();

      const withTrack = addTrack(timeline, "video", "Video 2");
      assert.equal(withTrack.tracks.length, 3);
      const newTrack = withTrack.tracks[2];
      assert.equal(newTrack.name, "Video 2");

      const locked = toggleTrackLock(withTrack, newTrack.id);
      assert.equal(locked.tracks[2].locked, true);

      const muted = toggleTrackMute(locked, newTrack.id);
      assert.equal(muted.tracks[2].muted, true);

      const solo = toggleTrackSolo(muted, newTrack.id);
      assert.equal(solo.tracks[2].solo, true);

      const hidden = toggleTrackHidden(solo, newTrack.id);
      assert.equal(hidden.tracks[2].hidden, true);

      const syncLocked = toggleTrackSyncLock(hidden, newTrack.id);
      assert.equal(syncLocked.tracks[2].syncLocked, false);

      const renamed = renameTrack(syncLocked, newTrack.id, "B-Roll");
      assert.equal(renamed.tracks[2].name, "B-Roll");

      const reordered = reorderTrack(renamed, newTrack.id, "up");
      assert.equal(reordered.tracks[1].id, newTrack.id);

      const removed = removeTrack(reordered, newTrack.id);
      assert.equal(removed.tracks.length, 2);
    });
  });

  describe("Markers", () => {
    test("addMarker, updateMarker, removeMarker, findNearestMarker", () => {
      const { timeline } = createTestTimeline();

      const withM1 = addMarker(timeline, { time: 5.0, label: "Interview Start", color: "#3b82f6" });
      const withM2 = addMarker(withM1, { time: 10.0, label: "B-Roll Cut", color: "#10b981" });

      assert.equal(withM2.markers?.length, 2);
      assert.equal(withM2.markers![0].time, 5.0);
      assert.equal(withM2.markers![1].time, 10.0);

      const nearest = findNearestMarker(withM2, 4.8, "any");
      assert.equal(nearest?.label, "Interview Start");

      const next = findNearestMarker(withM2, 5.0, "next");
      assert.equal(next?.label, "B-Roll Cut");

      const prev = findNearestMarker(withM2, 10.0, "prev");
      assert.equal(prev?.label, "Interview Start");

      const updated = updateMarker(withM2, withM2.markers![0].id, { label: "Updated Title" });
      assert.equal(updated.markers![0].label, "Updated Title");

      const removed = removeMarker(updated, withM2.markers![0].id);
      assert.equal(removed.markers?.length, 1);
    });
  });

  describe("Clipboard", () => {
    test("copyClips and pasteClips paste at playhead offset", () => {
      const { timeline, clip1Id, clip2Id } = createTestTimeline();

      const copied = copyClips(timeline, [clip1Id, clip2Id]);
      assert.equal(copied.length, 2);
      assert.equal(copied[0].startTime, 0);
      assert.equal(copied[1].startTime, 5);

      // Paste at 20s
      const pasted = pasteClips(timeline, copied, 20);
      const vTrack = pasted.tracks[0];
      assert.equal(vTrack.clips.length, 5); // 3 original + 2 pasted

      const p1 = vTrack.clips.find((c) => Math.abs(c.startTime - 20) < 0.001);
      const p2 = vTrack.clips.find((c) => Math.abs(c.startTime - 25) < 0.001);
      assert.ok(p1);
      assert.ok(p2);
      assert.notEqual(p1.id, clip1Id); // unique new IDs
      assert.notEqual(p2.id, clip2Id);
    });
  });
});

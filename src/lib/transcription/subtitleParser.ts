/**
 * Subtitle and transcript parsing and serialization (SRT / WebVTT).
 *
 * Rules:
 * - 100% deterministic local parsing in browser.
 * - Handles standard SubRip (.srt) and WebVTT (.vtt) syntax.
 * - Strips presentation tags (<b>, <i>, <v Speaker>, etc.) while preserving plain text.
 * - Validates monotonic timing, non-negative start, and positive cue duration.
 * - Provides serializers to generate valid SRT and VTT from timeline text overlays.
 */

import type { TranscriptionCue } from "../../types/transcription.ts";

/**
 * Strips HTML and WebVTT formatting tags from cue text.
 */
export function cleanSubtitleText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "") // Remove HTML/VTT tags like <v Speaker>, <b>, etc.
    .replace(/\{[^}]+\}/g, "") // Remove SSA/ASS style override tags
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

/**
 * Parses timestamp string (either SRT "00:01:23,456" or VTT "00:01:23.456" / "01:23.456") to seconds.
 */
export function parseTimestampToSeconds(timestampStr: string): number | null {
  const clean = timestampStr.trim().replace(",", ".");
  // Format: [[HH:]MM:]SS.mmm or HH:MM:SS.mmm
  const parts = clean.split(":");
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (parts.length === 3) {
    hours = parseFloat(parts[0]);
    minutes = parseFloat(parts[1]);
    seconds = parseFloat(parts[2]);
  } else {
    minutes = parseFloat(parts[0]);
    seconds = parseFloat(parts[1]);
  }

  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
    return null;
  }

  return Number((hours * 3600 + minutes * 60 + seconds).toFixed(3));
}

/**
 * Formats seconds into SRT timestamp string "HH:MM:SS,mmm".
 */
export function formatSecondsToSrtTimestamp(seconds: number): string {
  const safeSec = Math.max(0, seconds);
  const h = Math.floor(safeSec / 3600);
  const m = Math.floor((safeSec % 3600) / 60);
  const s = Math.floor(safeSec % 60);
  const ms = Math.floor((safeSec % 1) * 1000);

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/**
 * Formats seconds into WebVTT timestamp string "HH:MM:SS.mmm".
 */
export function formatSecondsToVttTimestamp(seconds: number): string {
  const safeSec = Math.max(0, seconds);
  const h = Math.floor(safeSec / 3600);
  const m = Math.floor((safeSec % 3600) / 60);
  const s = Math.floor(safeSec % 60);
  const ms = Math.floor((safeSec % 1) * 1000);

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/**
 * Parses raw SRT subtitle text into validated TranscriptionCue items.
 */
export function parseSrt(content: string): { cues: TranscriptionCue[]; errors: string[] } {
  const cues: TranscriptionCue[] = [];
  const errors: string[] = [];

  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return { cues: [], errors: ["SRT content is empty"] };
  }

  const blocks = normalized.split(/\n\s*\n/);

  for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
    const lines = blocks[bIdx].trim().split("\n");
    if (lines.length < 2) continue;

    // Line 0 is usually index or timing line
    let timeLineIdx = 0;
    if (/^\d+$/.test(lines[0].trim()) && lines.length >= 2) {
      timeLineIdx = 1;
    }

    const timeLine = lines[timeLineIdx];
    const match = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/);
    if (!match) {
      continue;
    }

    const start = parseTimestampToSeconds(match[1]);
    const end = parseTimestampToSeconds(match[2]);

    if (start === null || end === null) {
      errors.push(`Block ${bIdx + 1}: Unparseable timestamps "${timeLine}"`);
      continue;
    }

    if (start < 0 || end <= start) {
      errors.push(`Block ${bIdx + 1}: Invalid range [${start}s -> ${end}s]`);
      continue;
    }

    const textLines = lines.slice(timeLineIdx + 1);
    const cleanedText = cleanSubtitleText(textLines.join(" "));
    if (!cleanedText) continue;

    const cueId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `cue-${bIdx + 1}`;

    cues.push({
      id: cueId,
      start,
      end,
      text: cleanedText,
    });
  }

  // Sort chronologically
  cues.sort((a, b) => a.start - b.start);

  return { cues, errors };
}

/**
 * Parses raw WebVTT subtitle text into validated TranscriptionCue items.
 */
export function parseVtt(content: string): { cues: TranscriptionCue[]; errors: string[] } {
  const cues: TranscriptionCue[] = [];
  const errors: string[] = [];

  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized.startsWith("WEBVTT")) {
    errors.push("Missing WEBVTT header");
  }

  const blocks = normalized.split(/\n\s*\n/);

  for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
    const block = blocks[bIdx].trim();
    if (block === "WEBVTT" || block.startsWith("NOTE")) {
      continue;
    }

    const lines = block.split("\n");
    let timeLineIdx = -1;

    for (let l = 0; l < lines.length; l++) {
      if (lines[l].includes("-->")) {
        timeLineIdx = l;
        break;
      }
    }

    if (timeLineIdx === -1) continue;

    const timeLine = lines[timeLineIdx];
    const match = timeLine.match(/((?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3})/);
    if (!match) continue;

    const start = parseTimestampToSeconds(match[1]);
    const end = parseTimestampToSeconds(match[2]);

    if (start === null || end === null || start < 0 || end <= start) {
      errors.push(`VTT Block ${bIdx + 1}: Invalid timestamp "${timeLine}"`);
      continue;
    }

    const textLines = lines.slice(timeLineIdx + 1);
    const cleanedText = cleanSubtitleText(textLines.join(" "));
    if (!cleanedText) continue;

    const cueId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `vtt-cue-${bIdx + 1}`;

    cues.push({
      id: cueId,
      start,
      end,
      text: cleanedText,
    });
  }

  cues.sort((a, b) => a.start - b.start);

  return { cues, errors };
}

/**
 * Auto-detects and parses either SRT or VTT content.
 */
export function parseSubtitleFileContent(content: string): { cues: TranscriptionCue[]; errors: string[]; format: "srt" | "vtt" } {
  if (content.trim().startsWith("WEBVTT")) {
    const res = parseVtt(content);
    return { ...res, format: "vtt" };
  }
  const res = parseSrt(content);
  return { ...res, format: "srt" };
}

/**
 * Serializes TranscriptionCue items into standard SRT format.
 */
export function serializeToSrt(cues: TranscriptionCue[]): string {
  return cues
    .map((cue, idx) => {
      const startStr = formatSecondsToSrtTimestamp(cue.start);
      const endStr = formatSecondsToSrtTimestamp(cue.end);
      return `${idx + 1}\n${startStr} --> ${endStr}\n${cue.text}\n`;
    })
    .join("\n");
}

/**
 * Serializes TranscriptionCue items into standard WebVTT format.
 */
export function serializeToVtt(cues: TranscriptionCue[]): string {
  const body = cues
    .map((cue, idx) => {
      const startStr = formatSecondsToVttTimestamp(cue.start);
      const endStr = formatSecondsToVttTimestamp(cue.end);
      return `${idx + 1}\n${startStr} --> ${endStr}\n${cue.text}\n`;
    })
    .join("\n");

  return `WEBVTT\n\n${body}`;
}

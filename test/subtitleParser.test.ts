import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseSrt,
  parseVtt,
  parseSubtitleFileContent,
  serializeToSrt,
  serializeToVtt,
  cleanSubtitleText,
  parseTimestampToSeconds,
  formatSecondsToSrtTimestamp,
  formatSecondsToVttTimestamp,
} from "../src/lib/transcription/subtitleParser.ts";

describe("Subtitle & Transcript Parsing (SRT & WebVTT)", () => {
  test("cleanSubtitleText strips HTML tags, speaker tags, and whitespace", () => {
    const raw = "  <v Alice>Hello <b>world</b>!</v> {\\pos(192,200)}How are you?  \r\n";
    const cleaned = cleanSubtitleText(raw);
    assert.equal(cleaned, "Hello world! How are you?");
  });

  test("parseTimestampToSeconds parses standard SRT and VTT formats", () => {
    // SRT format with comma
    assert.equal(parseTimestampToSeconds("00:01:23,456"), 83.456);
    // VTT format with dot
    assert.equal(parseTimestampToSeconds("00:01:23.456"), 83.456);
    // Short VTT format MM:SS.mmm
    assert.equal(parseTimestampToSeconds("01:23.456"), 83.456);
    // Zero
    assert.equal(parseTimestampToSeconds("00:00:00,000"), 0);
    // Invalid
    assert.equal(parseTimestampToSeconds("invalid-time"), null);
  });

  test("formatSecondsToSrtTimestamp and formatSecondsToVttTimestamp format accurately", () => {
    const srt = formatSecondsToSrtTimestamp(83.456);
    assert.equal(srt, "00:01:23,456");

    const vtt = formatSecondsToVttTimestamp(83.456);
    assert.equal(vtt, "00:01:23.456");
  });

  test("parseSrt parses standard SubRip cues with index numbers and formatting", () => {
    const srtContent = `
1
00:00:01,000 --> 00:00:04,500
Welcome to Content Studio.

2
00:00:05,000 --> 00:00:09,200
In this video, we build <i>local-first</i> media apps.
`;

    const { cues, errors } = parseSrt(srtContent);
    assert.equal(errors.length, 0);
    assert.equal(cues.length, 2);

    assert.equal(cues[0].start, 1.0);
    assert.equal(cues[0].end, 4.5);
    assert.equal(cues[0].text, "Welcome to Content Studio.");

    assert.equal(cues[1].start, 5.0);
    assert.equal(cues[1].end, 9.2);
    assert.equal(cues[1].text, "In this video, we build local-first media apps.");
  });

  test("parseVtt parses standard WebVTT cues with header and cues", () => {
    const vttContent = `WEBVTT
NOTE This is a test comment

00:01.000 --> 00:04.500
<v Narrator>Welcome to the project.</v>

00:05.200 --> 00:08.800
We preserve full sentences and thoughts.
`;

    const { cues, errors } = parseVtt(vttContent);
    assert.equal(errors.length, 0);
    assert.equal(cues.length, 2);

    assert.equal(cues[0].start, 1.0);
    assert.equal(cues[0].end, 4.5);
    assert.equal(cues[0].text, "Welcome to the project.");

    assert.equal(cues[1].start, 5.2);
    assert.equal(cues[1].end, 8.8);
    assert.equal(cues[1].text, "We preserve full sentences and thoughts.");
  });

  test("parseSubtitleFileContent auto-detects format correctly", () => {
    const vtt = parseSubtitleFileContent("WEBVTT\n\n00:01.000 --> 00:02.000\nHello");
    assert.equal(vtt.format, "vtt");
    assert.equal(vtt.cues.length, 1);

    const srt = parseSubtitleFileContent("1\n00:00:01,000 --> 00:00:02,000\nHello");
    assert.equal(srt.format, "srt");
    assert.equal(srt.cues.length, 1);
  });

  test("serialization roundtrip preserves cue timing and text", () => {
    const originalCues = [
      { id: "c1", start: 2.5, end: 6.2, text: "First thought in excerpt." },
      { id: "c2", start: 7.0, end: 11.5, text: "Second complementary thought." },
    ];

    const srt = serializeToSrt(originalCues);
    const parsedBack = parseSrt(srt);

    assert.equal(parsedBack.errors.length, 0);
    assert.equal(parsedBack.cues.length, 2);
    assert.equal(parsedBack.cues[0].start, 2.5);
    assert.equal(parsedBack.cues[0].end, 6.2);
    assert.equal(parsedBack.cues[0].text, "First thought in excerpt.");

    const vtt = serializeToVtt(originalCues);
    const parsedVtt = parseVtt(vtt);
    assert.equal(parsedVtt.errors.length, 0);
    assert.equal(parsedVtt.cues.length, 2);
    assert.equal(parsedVtt.cues[1].start, 7.0);
    assert.equal(parsedVtt.cues[1].end, 11.5);
    assert.equal(parsedVtt.cues[1].text, "Second complementary thought.");
  });

  test("rejects invalid or unparseable blocks safely without throwing", () => {
    const corrupt = "1\nnot-a-time --> bad-time\nHello";
    const res = parseSrt(corrupt);
    assert.equal(res.cues.length, 0);
  });
});

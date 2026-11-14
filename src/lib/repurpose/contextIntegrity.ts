/**
 * Context Integrity and Speech-Thought Analysis Engine (Phase 8).
 *
 * Rules:
 * - A grammatically complete sentence is NOT automatically context-complete.
 * - Detects dependencies: prior questions, unresolved pronouns/referents, discourse continuations,
 *   conditionals, list items, definitions, punchlines, and unfinished payoff.
 * - Applies evidence-based context expansion (NOT fixed padding): expands backward to include
 *   the required setup/premise, and forward to include complete conclusion/payoff.
 * - Calculates 5 separate dimensions:
 *   1. speechBoundaryIntegrity
 *   2. thoughtCompleteness
 *   3. contextSufficiency
 *   4. standaloneClarity
 *   5. endingClosure
 * - Preserves surrounding transcript before/after for user review.
 */

import type { TranscriptionCue } from "../../types/transcription.ts";

export interface ContextDimensionAssessment {
  score: number; // 0..100
  isSatisfied: boolean;
  reason: string;
}

export interface ContextIntegrityReport {
  speechBoundaryIntegrity: ContextDimensionAssessment;
  thoughtCompleteness: ContextDimensionAssessment;
  contextSufficiency: ContextDimensionAssessment;
  standaloneClarity: ContextDimensionAssessment;
  endingClosure: ContextDimensionAssessment;
  overallContextScore: number;
  isContextComplete: boolean;
  unresolvedDependencies: string[];
  expansionRecommendation?: {
    suggestedSourceIn: number;
    suggestedSourceOut: number;
    reason: string;
    setupCuesIncluded: string[];
  };
  precedingTranscript: string;
  candidateTranscript: string;
  followingTranscript: string;
}

// Pronouns and deictic references that indicate dependencies on prior sentences
const PRONOUN_REFERENTS = new Set([
  "he", "she", "they", "it", "this", "that", "these", "those", "him", "her", "them", "its", "their", "his"
]);

// Discourse continuations or contrastive openers that require prior context
const DISCOURSE_CONTINUATIONS = [
  "that's why", "thats why", "because of that", "as i said", "the same thing",
  "another reason", "the second one", "the third one", "this is what happened",
  "and so", "so then", "therefore", "however", "furthermore", "moreover",
  "on the other hand", "consequently", "in addition", "but then", "also then"
];

// Conversational answer indicators that depend on a preceding question
const ANSWER_STARTERS = [
  "yes", "no", "absolutely", "definitely", "because", "the reason is", "exactly", "not really", "well,"
];

// Question words that introduce an inquiry
const QUESTION_STARTERS = [
  "who", "what", "where", "when", "why", "how", "is", "are", "can", "could", "would", "do", "does", "did", "should"
];

/**
 * Checks whether text ends with terminal sentence punctuation.
 */
export function endsWithSentencePunctuation(text: string): boolean {
  const trimmed = text.trim();
  return /[.!?]["']?$/.test(trimmed);
}

/**
 * Checks whether text starts with capital letter or question opener.
 */
export function startsWithSentenceCapital(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  const firstChar = trimmed[0];
  return firstChar === firstChar.toUpperCase() && /[A-Z]/.test(firstChar);
}

/**
 * Identifies cues within an interval [sourceIn, sourceOut].
 */
export function getCuesInInterval(
  cues: TranscriptionCue[],
  sourceIn: number,
  sourceOut: number
): {
  insideCues: TranscriptionCue[];
  precedingCues: TranscriptionCue[];
  followingCues: TranscriptionCue[];
} {
  const insideCues: TranscriptionCue[] = [];
  const precedingCues: TranscriptionCue[] = [];
  const followingCues: TranscriptionCue[] = [];

  for (const c of cues) {
    if (c.end <= sourceIn + 0.1) {
      precedingCues.push(c);
    } else if (c.start >= sourceOut - 0.1) {
      followingCues.push(c);
    } else {
      // Overlaps interval
      insideCues.push(c);
    }
  }

  return { insideCues, precedingCues, followingCues };
}

/**
 * Evaluates context integrity and dependencies for a candidate excerpt.
 */
export function evaluateContextIntegrity(
  allCues: TranscriptionCue[],
  sourceIn: number,
  sourceOut: number
): ContextIntegrityReport {
  if (allCues.length === 0) {
    return {
      speechBoundaryIntegrity: { score: 50, isSatisfied: false, reason: "No transcript available to verify speech boundaries." },
      thoughtCompleteness: { score: 50, isSatisfied: false, reason: "Unknown thought completeness (no speech transcript)." },
      contextSufficiency: { score: 50, isSatisfied: false, reason: "Unknown context sufficiency (no speech transcript)." },
      standaloneClarity: { score: 50, isSatisfied: false, reason: "Unknown standalone clarity (no speech transcript)." },
      endingClosure: { score: 50, isSatisfied: false, reason: "Unknown ending closure (no speech transcript)." },
      overallContextScore: 50,
      isContextComplete: false,
      unresolvedDependencies: ["Missing transcript evidence"],
      precedingTranscript: "",
      candidateTranscript: "",
      followingTranscript: "",
    };
  }

  const { insideCues, precedingCues, followingCues } = getCuesInInterval(allCues, sourceIn, sourceOut);

  const candidateText = insideCues.map((c) => c.text).join(" ").trim();
  const precedingText = precedingCues.slice(-3).map((c) => c.text).join(" ").trim();
  const followingText = followingCues.slice(0, 3).map((c) => c.text).join(" ").trim();

  if (insideCues.length === 0) {
    return {
      speechBoundaryIntegrity: { score: 40, isSatisfied: false, reason: "Interval falls in a speech pause or silence." },
      thoughtCompleteness: { score: 40, isSatisfied: false, reason: "No spoken content in interval." },
      contextSufficiency: { score: 40, isSatisfied: false, reason: "No spoken content in interval." },
      standaloneClarity: { score: 40, isSatisfied: false, reason: "No spoken content in interval." },
      endingClosure: { score: 40, isSatisfied: false, reason: "No spoken content in interval." },
      overallContextScore: 40,
      isContextComplete: false,
      unresolvedDependencies: ["Interval contains no speech cues"],
      precedingTranscript: precedingText,
      candidateTranscript: "",
      followingTranscript: followingText,
    };
  }

  const firstCue = insideCues[0];
  const lastCue = insideCues[insideCues.length - 1];
  const firstWords = firstCue.text.toLowerCase().split(/\s+/).filter(Boolean);
  const firstWord = firstWords[0] || "";

  const unresolvedDependencies: string[] = [];

  // 1. Speech boundary integrity
  const startsNearCueStart = Math.abs(sourceIn - firstCue.start) <= 0.65;
  const endsNearCueEnd = Math.abs(sourceOut - lastCue.end) <= 0.65;
  let boundaryScore = 100;
  let boundaryReason = "Excerpt aligns cleanly with speech cue boundaries.";

  if (!startsNearCueStart) {
    boundaryScore -= 30;
    boundaryReason = `Start cut occurs at ${sourceIn.toFixed(2)}s, inside cue starting at ${firstCue.start.toFixed(2)}s.`;
  }
  if (!endsNearCueEnd) {
    boundaryScore -= 30;
    boundaryReason += ` End cut occurs at ${sourceOut.toFixed(2)}s, mid-cue ending at ${lastCue.end.toFixed(2)}s.`;
  }
  const speechBoundaryIntegrity: ContextDimensionAssessment = {
    score: Math.max(0, boundaryScore),
    isSatisfied: startsNearCueStart && endsNearCueEnd,
    reason: boundaryReason,
  };

  // 2. Check for Discourse Continuations & Openers
  let hasDiscourseOpener = false;
  for (const disc of DISCOURSE_CONTINUATIONS) {
    if (firstCue.text.toLowerCase().startsWith(disc)) {
      hasDiscourseOpener = true;
      unresolvedDependencies.push(`Begins with continuation phrase "${disc}" lacking prior context`);
      break;
    }
  }

  // Check single-word contrast/continuation ("But", "And", "So", "However")
  if (!hasDiscourseOpener && ["but", "so", "and", "however", "though", "yet"].includes(firstWord)) {
    hasDiscourseOpener = true;
    unresolvedDependencies.push(`Begins with contrast/conjunction "${firstWord}" referencing omitted statement`);
  }

  // 3. Check for Answer without Question
  let isAnswerWithoutQuestion = false;
  const isAnswerStart = ANSWER_STARTERS.some((ans) => firstCue.text.toLowerCase().startsWith(ans));
  if (isAnswerStart) {
    // Check if the preceding cue was a question
    const lastPreceding = precedingCues[precedingCues.length - 1];
    if (lastPreceding && (lastPreceding.text.includes("?") || QUESTION_STARTERS.some((q) => lastPreceding.text.toLowerCase().startsWith(q)))) {
      isAnswerWithoutQuestion = true;
      unresolvedDependencies.push(`Answer "${firstCue.text.slice(0, 30)}..." depends on prior question "${lastPreceding.text}"`);
    }
  }

  // 4. Check for Unresolved Pronouns at opening
  let hasUnresolvedPronoun = false;
  if (PRONOUN_REFERENTS.has(firstWord) || (PRONOUN_REFERENTS.has(firstWords[1] || "") && ["in", "on", "at", "for", "with", "because"].includes(firstWord))) {
    hasUnresolvedPronoun = true;
    unresolvedDependencies.push(`Opening subject uses pronoun "${firstWord}" whose referent was introduced earlier`);
  }

  // 5. Ending closure (does it finish with punctuation / completed thought)
  const endsWithPunct = endsWithSentencePunctuation(lastCue.text);
  const endingWords = lastCue.text.toLowerCase().split(/\s+/).filter(Boolean);
  const lastWord = endingWords[endingWords.length - 1] || "";
  const danglingEndings = ["and", "or", "but", "because", "if", "when", "that", "which", "with", "the", "a", "an", "to"];
  const isDanglingEnd = danglingEndings.includes(lastWord.replace(/[^a-z]/g, ""));

  let endingScore = 100;
  let endingReason = "Statement concludes naturally with complete ending punctuation.";
  if (isDanglingEnd) {
    endingScore = 20;
    endingReason = `Thought is truncated mid-flow at dangling conjunction/preposition "${lastWord}".`;
    unresolvedDependencies.push(`Ends abruptly on incomplete phrase "${lastWord}"`);
  } else if (!endsWithPunct) {
    endingScore = 55;
    endingReason = "Cue ends without terminal punctuation; thought may continue into next sentence.";
  }

  const endingClosure: ContextDimensionAssessment = {
    score: endingScore,
    isSatisfied: endingScore >= 70,
    reason: endingReason,
  };

  // 6. Context sufficiency & standalone clarity
  let sufficiencyScore = 100;
  if (isAnswerWithoutQuestion) sufficiencyScore -= 35;
  if (hasUnresolvedPronoun) sufficiencyScore -= 30;
  if (hasDiscourseOpener) sufficiencyScore -= 25;
  sufficiencyScore = Math.max(10, sufficiencyScore);

  const contextSufficiency: ContextDimensionAssessment = {
    score: sufficiencyScore,
    isSatisfied: sufficiencyScore >= 70,
    reason: unresolvedDependencies.length === 0
      ? "Excerpt possesses clear subjects, referents, and self-contained premise."
      : unresolvedDependencies.join("; "),
  };

  const clarityScore = Math.round((sufficiencyScore + speechBoundaryIntegrity.score) / 2);
  const standaloneClarity: ContextDimensionAssessment = {
    score: clarityScore,
    isSatisfied: clarityScore >= 70,
    reason: clarityScore >= 70
      ? "Makes sense when played from its first frame without watching the full video."
      : "Viewer lacks prerequisite setup to understand statement significance.",
  };

  // 7. Thought completeness
  let thoughtScore = 100;
  if (isDanglingEnd) thoughtScore -= 50;
  if (unresolvedDependencies.length > 0) thoughtScore -= 20 * Math.min(2, unresolvedDependencies.length);
  thoughtScore = Math.max(15, thoughtScore);

  const thoughtCompleteness: ContextDimensionAssessment = {
    score: thoughtScore,
    isSatisfied: thoughtScore >= 70,
    reason: thoughtScore >= 70
      ? "Expresses a complete proposition, explanation, or story beat."
      : "Incomplete thought: requires setup expansion or payoff completion.",
  };

  // 8. Expansion recommendation if dependencies exist
  let expansionRecommendation: ContextIntegrityReport["expansionRecommendation"] = undefined;
  if (unresolvedDependencies.length > 0 && precedingCues.length > 0) {
    // Propose expanding backward to include required question or preceding sentence
    let newIn = sourceIn;
    const includedCues: string[] = [];

    // Expand backwards to include up to 2 preceding cues if needed
    const setupCuesNeeded = isAnswerWithoutQuestion ? 1 : (hasUnresolvedPronoun || hasDiscourseOpener ? 1 : 0);
    if (setupCuesNeeded > 0) {
      const neededCue = precedingCues[precedingCues.length - setupCuesNeeded];
      if (neededCue) {
        newIn = neededCue.start;
        for (let i = precedingCues.length - setupCuesNeeded; i < precedingCues.length; i++) {
          includedCues.push(precedingCues[i].text);
        }
      }
    }

    let newOut = sourceOut;
    if (isDanglingEnd && followingCues.length > 0) {
      newOut = followingCues[0].end;
    }

    if (newIn !== sourceIn || newOut !== sourceOut) {
      expansionRecommendation = {
        suggestedSourceIn: Number(newIn.toFixed(2)),
        suggestedSourceOut: Number(newOut.toFixed(2)),
        reason: `Expand to include setup: "${includedCues.join(" ")}" for standalone clarity.`,
        setupCuesIncluded: includedCues,
      };
    }
  }

  const overallContextScore = Math.round(
    speechBoundaryIntegrity.score * 0.2 +
    thoughtCompleteness.score * 0.25 +
    contextSufficiency.score * 0.25 +
    standaloneClarity.score * 0.15 +
    endingClosure.score * 0.15
  );

  const isContextComplete =
    speechBoundaryIntegrity.isSatisfied &&
    thoughtCompleteness.isSatisfied &&
    contextSufficiency.isSatisfied &&
    endingClosure.isSatisfied &&
    unresolvedDependencies.length === 0;

  return {
    speechBoundaryIntegrity,
    thoughtCompleteness,
    contextSufficiency,
    standaloneClarity,
    endingClosure,
    overallContextScore,
    isContextComplete,
    unresolvedDependencies,
    expansionRecommendation,
    precedingTranscript: precedingText,
    candidateTranscript: candidateText,
    followingTranscript: followingText,
  };
}

/**
 * Builds candidate thought clusters from transcript cues by grouping
 * sentences into cohesive standalone thoughts and applying context expansion.
 */
export function buildThoughtClustersFromCues(
  cues: TranscriptionCue[],
  sourceDuration: number
): Array<{
  sourceIn: number;
  sourceOut: number;
  duration: number;
  transcriptSnippet: string;
  contextReport: ContextIntegrityReport;
}> {
  if (cues.length === 0) return [];

  const clusters: Array<{
    sourceIn: number;
    sourceOut: number;
    duration: number;
    transcriptSnippet: string;
    contextReport: ContextIntegrityReport;
  }> = [];

  let currentCues: TranscriptionCue[] = [];
  let clusterStart = cues[0].start;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    currentCues.push(cue);

    const hasTerminalPunct = endsWithSentencePunctuation(cue.text);
    const nextCue = cues[i + 1];
    const pauseToNext = nextCue ? nextCue.start - cue.end : Infinity;

    // Form a thought cluster when we hit sentence ending AND (natural pause > 0.8s OR thought length >= 8s)
    const currentDur = cue.end - clusterStart;
    const shouldBreak =
      hasTerminalPunct &&
      (currentDur >= 6.0 || pauseToNext >= 0.7 || !nextCue);

    if (shouldBreak) {
      let candIn = clusterStart;
      let candOut = cue.end;

      // Evaluate context integrity
      let report = evaluateContextIntegrity(cues, candIn, candOut);

      // Apply context expansion if setup is needed
      if (report.expansionRecommendation) {
        candIn = report.expansionRecommendation.suggestedSourceIn;
        candOut = report.expansionRecommendation.suggestedSourceOut;
        report = evaluateContextIntegrity(cues, candIn, candOut);
      }

      const dur = Number((candOut - candIn).toFixed(2));
      const textSnippet = cues
        .filter((c) => c.start >= candIn - 0.1 && c.end <= candOut + 0.1)
        .map((c) => c.text)
        .join(" ")
        .trim();

      if (dur > 0 && dur <= sourceDuration) {
        clusters.push({
          sourceIn: Number(candIn.toFixed(2)),
          sourceOut: Number(candOut.toFixed(2)),
          duration: dur,
          transcriptSnippet: textSnippet,
          contextReport: report,
        });
      }

      // Next cluster start
      if (nextCue) {
        clusterStart = nextCue.start;
        currentCues = [];
      }
    }
  }

  // If leftover cues form a valid sentence, add them
  if (currentCues.length > 0) {
    const first = currentCues[0];
    const last = currentCues[currentCues.length - 1];
    const candIn = first.start;
    const candOut = last.end;
    const report = evaluateContextIntegrity(cues, candIn, candOut);
    const dur = Number((candOut - candIn).toFixed(2));

    if (dur >= 3.0 && dur <= sourceDuration) {
      clusters.push({
        sourceIn: Number(candIn.toFixed(2)),
        sourceOut: Number(candOut.toFixed(2)),
        duration: dur,
        transcriptSnippet: currentCues.map((c) => c.text).join(" "),
        contextReport: report,
      });
    }
  }

  return clusters;
}

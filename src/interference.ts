import type { TranscribedNote } from "./transcribe.ts";

export interface InvariantToneOptions {
  /** A pitch must recur at least this many times before its stability is judged at all. */
  minOccurrences?: number;
  /** A recurring pitch is flagged when its own cents-stddev is this fraction (or less) of the median stddev across every other qualifying pitch. */
  stabilityRatio?: number;
}

const DEFAULT_MIN_OCCURRENCES = 4;
const DEFAULT_STABILITY_RATIO = 0.5;

/**
 * Flags notes whose pitch repeats unusually often across well-separated
 * takes *and* lands on almost exactly the same Hz every time - tighter than
 * this recording's own typical repeat precision. A human voice re-attacking
 * "the same" note naturally drifts a few cents take to take; a non-vocal
 * tone bleeding into the recording (electronics, a notification, a fan)
 * doesn't. Needs at least two differently-pitched recurring groups to
 * compare against each other, so a melody with only one repeated note never
 * gets judged "too stable" against itself.
 */
export function rejectInvariantTones(notes: TranscribedNote[], options: InvariantToneOptions = {}): TranscribedNote[] {
  const minOccurrences = options.minOccurrences ?? DEFAULT_MIN_OCCURRENCES;
  const stabilityRatio = options.stabilityRatio ?? DEFAULT_STABILITY_RATIO;

  const groupsByPitch = new Map<number, TranscribedNote[]>();
  for (const note of notes) {
    const group = groupsByPitch.get(note.midiPitch);
    if (group) group.push(note);
    else groupsByPitch.set(note.midiPitch, [note]);
  }

  const qualifying = [...groupsByPitch.values()].filter((group) => group.length >= minOccurrences);
  if (qualifying.length < 2) return notes;

  const stddevCentsByPitch = new Map<number, number>();
  for (const group of qualifying) stddevCentsByPitch.set(group[0].midiPitch, stddevCents(group));

  const medianStddevCents = median([...stddevCentsByPitch.values()]);
  const flaggedPitches = new Set(
    [...stddevCentsByPitch.entries()].filter(([, stddev]) => stddev <= stabilityRatio * medianStddevCents).map(([pitch]) => pitch),
  );
  if (flaggedPitches.size === 0) return notes;

  return notes.filter((note) => !flaggedPitches.has(note.midiPitch));
}

function stddevCents(notes: TranscribedNote[]): number {
  const values = notes.map((note) => note.rawPitch);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) * 100;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

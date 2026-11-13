import { DEFAULT_HOP_SIZE, detectPitchYin } from "./yin.ts";
import { removePitchOutliers, smoothPitchTrajectory } from "./smoothing.ts";
import { segmentNotes } from "./segmentation.ts";
import { rejectInvariantTones } from "./interference.ts";

export interface TranscribedNote {
  midiPitch: number;
  rawPitch: number;
  startMs: number;
  durationMs: number;
  velocity: number;
  confidence: number;
}

/**
 * A voiced run shorter than this is treated as a breath/transient blip, not
 * a deliberate note - well below the shortest plausible hummed note, so it
 * only filters out things a human didn't mean to sing.
 */
const MIN_NOTE_DURATION_MS = 100;

/**
 * Audio-to-melody transcription pipeline: raw samples -> YIN pitch track ->
 * outlier removal and smoothing -> note segmentation -> non-vocal
 * interference rejection -> integer MIDI notes ready for export. There is
 * no tempo/beat model yet, so timing stays in ms.
 */
export function transcribeMelody(samples: Float32Array, sampleRate: number): TranscribedNote[] {
  const rawFrames = detectPitchYin(samples, sampleRate);
  const cleaned = smoothPitchTrajectory(removePitchOutliers(rawFrames));
  const hopMs = (DEFAULT_HOP_SIZE / sampleRate) * 1000;
  const minVoicedFrames = Math.max(2, Math.ceil(MIN_NOTE_DURATION_MS / hopMs));
  const candidates = segmentNotes(cleaned, { hopMs, minVoicedFrames });

  const notes = candidates.map((candidate) => ({
    midiPitch: clampMidiPitch(Math.round(candidate.rawPitch)),
    rawPitch: candidate.rawPitch,
    startMs: candidate.startMs,
    durationMs: candidate.durationMs,
    velocity: estimateVelocity(samples, sampleRate, candidate.startMs, candidate.durationMs),
    confidence: candidate.onsetConfidence,
  }));

  return rejectInvariantTones(notes);
}

function clampMidiPitch(pitch: number): number {
  return Math.min(127, Math.max(0, pitch));
}

// Scaling factor chosen so a full-scale sine (RMS ~0.707) maps near the top
// of the MIDI velocity range; proposed value, to be revisited with real
// humming recordings (see docs/specs/audio-analysis.md).
const VELOCITY_RMS_SCALE = 170;

function estimateVelocity(samples: Float32Array, sampleRate: number, startMs: number, durationMs: number): number {
  const startSample = Math.max(0, Math.floor((startMs / 1000) * sampleRate));
  const endSample = Math.min(samples.length, Math.floor(((startMs + durationMs) / 1000) * sampleRate));

  let sumOfSquares = 0;
  let count = 0;
  for (let i = startSample; i < endSample; i++) {
    sumOfSquares += samples[i] * samples[i];
    count++;
  }
  if (count === 0) return 64;

  const rms = Math.sqrt(sumOfSquares / count);
  return Math.min(127, Math.max(1, Math.round(rms * VELOCITY_RMS_SCALE)));
}

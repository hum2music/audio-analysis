import type { PitchFrame } from "@hum2music/core";

export const DEFAULT_FRAME_SIZE = 1024;
export const DEFAULT_HOP_SIZE = 512;

/**
 * A true fundamental period is also, by definition, periodic at every
 * integer multiple of itself, so its CMNDF dip and a harmonic's dip can
 * land within noise of each other. Candidates this close to the frame's
 * deepest dip are treated as tied; the smallest such tau (highest
 * frequency) is then picked, to still prefer the fundamental over an
 * octave-too-low subharmonic when the two are indistinguishably deep.
 */
const OCTAVE_TIE_EPSILON = 0.03;

export interface YinOptions {
  frameSize?: number;
  hopSize?: number;
  threshold?: number;
  minFrequencyHz?: number;
  maxFrequencyHz?: number;
}

/**
 * YIN pitch detection (de Cheveigne & Kawahara, 2002), evaluated per sliding
 * frame over the whole signal. Frames where no period passes the absolute
 * threshold are reported as unvoiced rather than forced to a guess.
 */
export function detectPitchYin(samples: Float32Array, sampleRate: number, options: YinOptions = {}): PitchFrame[] {
  const frameSize = options.frameSize ?? DEFAULT_FRAME_SIZE;
  const hopSize = options.hopSize ?? DEFAULT_HOP_SIZE;
  const threshold = options.threshold ?? 0.12;
  const minFrequencyHz = options.minFrequencyHz ?? 80;
  const maxFrequencyHz = options.maxFrequencyHz ?? 1000;

  const tauMin = Math.max(2, Math.floor(sampleRate / maxFrequencyHz));
  const tauMax = Math.min(Math.floor(frameSize / 2) - 1, Math.floor(sampleRate / minFrequencyHz));

  const frames: PitchFrame[] = [];
  const diff = new Float64Array(tauMax + 1);
  const cmndf = new Float64Array(tauMax + 1);

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < frameSize - tau; j++) {
        const delta = samples[start + j] - samples[start + j + tau];
        sum += delta * delta;
      }
      diff[tau] = sum;
    }

    cmndf[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      runningSum += diff[tau];
      cmndf[tau] = runningSum === 0 ? 1 : (diff[tau] * tau) / runningSum;
    }

    const tauEstimate = selectTauEstimate(cmndf, tauMin, tauMax, threshold);
    const timeMs = (start / sampleRate) * 1000;

    if (tauEstimate === -1) {
      frames.push({ timeMs, f0Hz: null, confidence: 0, voiced: false });
      continue;
    }

    const refinedTau = parabolicInterpolate(cmndf, tauEstimate, tauMax);
    const f0Hz = sampleRate / refinedTau;
    const confidence = Math.max(0, 1 - cmndf[tauEstimate]);

    frames.push({ timeMs, f0Hz, confidence, voiced: true });
  }

  return frames;
}

/**
 * Picks the tau whose CMNDF dip is deepest among every local minimum below
 * threshold, in increasing tau order (preferring the smallest/highest-
 * frequency tau among near-ties, within OCTAVE_TIE_EPSILON of the deepest
 * value found). A strong harmonic can dip below threshold at a short tau
 * before the true (longer-tau) fundamental period's dip does; picking the
 * first dip found, unconditionally, locks onto that harmonic as an
 * octave-too-high error. Returns -1 when no candidate dips below threshold.
 */
export function selectTauEstimate(cmndf: Float64Array, tauMin: number, tauMax: number, threshold: number): number {
  const candidateTaus: number[] = [];
  let deepestCmndf = Infinity;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmndf[tau] < threshold) {
      while (tau + 1 <= tauMax && cmndf[tau + 1] < cmndf[tau]) tau++;
      candidateTaus.push(tau);
      if (cmndf[tau] < deepestCmndf) deepestCmndf = cmndf[tau];
    }
  }

  for (const tau of candidateTaus) {
    if (cmndf[tau] <= deepestCmndf + OCTAVE_TIE_EPSILON) return tau;
  }
  return -1;
}

function parabolicInterpolate(cmndf: Float64Array, tau: number, tauMax: number): number {
  if (tau <= 0 || tau >= tauMax) return tau;
  const s0 = cmndf[tau - 1];
  const s1 = cmndf[tau];
  const s2 = cmndf[tau + 1];
  const denominator = s0 + s2 - 2 * s1;
  if (denominator === 0) return tau;
  return tau + (0.5 * (s0 - s2)) / denominator;
}

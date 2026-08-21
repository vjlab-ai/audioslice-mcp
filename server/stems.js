// Stem and stream vocabulary, mirroring Constants.h. Kept here so tool output
// can speak in names rather than indices.

export const STEMS = [
  "vocals", "bass", "other", "drums", "kick", "snare", "hihat", "perc", "tom",
  "audio", "beat", "beat_ramp", "is_music", "model_beat", "model_downbeat",
];

export const STREAMS = {
  energy: 1, pan: 2, onset: 3, spread: 4, pitch: 5,
};

export function stemName(i) {
  return STEMS[i] ?? `stem_${i}`;
}

export function stemIndex(nameOrIndex) {
  if (typeof nameOrIndex === "number") return nameOrIndex;
  const n = String(nameOrIndex).toLowerCase().trim();
  const i = STEMS.indexOf(n);
  if (i >= 0) return i;
  const parsed = Number.parseInt(n, 10);
  if (Number.isFinite(parsed)) return parsed;
  throw new Error(`Unknown stem "${nameOrIndex}". Valid: ${STEMS.join(", ")}`);
}

export function streamId(nameOrId) {
  if (typeof nameOrId === "number") return nameOrId;
  const n = String(nameOrId).toLowerCase().trim();
  if (n in STREAMS) return STREAMS[n];
  const parsed = Number.parseInt(n, 10);
  if (Number.isFinite(parsed)) return parsed;
  throw new Error(`Unknown stream "${nameOrId}". Valid: ${Object.keys(STREAMS).join(", ")}`);
}

/** The UI shows smoothing in milliseconds; the API takes an EMA coefficient. */
export const MS_PER_FRAME = 11.6099;
export function msToAlpha(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 1.0;
  return MS_PER_FRAME / (ms + MS_PER_FRAME);
}
export function alphaToMs(alpha) {
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) return 0;
  return MS_PER_FRAME / alpha - MS_PER_FRAME;
}

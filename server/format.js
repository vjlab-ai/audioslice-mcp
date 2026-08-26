// Turning API payloads into text a model can reason about without re-deriving
// arithmetic. Deliberately prose-ish rather than raw JSON: it is both cheaper in
// tokens and harder to misread than a wall of floats.

import { stemName, alphaToMs } from "./stems.js";

const pct = (v) => `${Math.round(v * 100)}%`;
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "?");
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : "?");

const CLOCK = { 1: "none", 2: "real-time tracker", 3: "metronome", 4: "Ableton Link", 5: "OSC" };

export function formatStatus(state) {
  const a = state.audio || {};
  const t = state.tempo || {};
  const e = state.engine || {};
  const lines = [];

  lines.push(a.hearingAudio
    ? `Hearing audio: YES (level ${f3(a.inputLevel)}, smoothed ${f3(a.inputLevelSlow)})`
    : `Hearing audio: NO - the noise gate is closed, so AudioSlice thinks the input is silent. ` +
      `Check the audio device and that something is actually playing.`);
  if (a.agcEnabled) {
    lines.push(`Auto gain is ON, so AudioSlice is riding the input level itself; manual gain has little effect.`);
  }

  lines.push(
    `Tempo: ${f2(t.bpm)} BPM, beat ${(t.beatInBar ?? 0) + 1}/${t.beatsPerBar ?? 4}, ` +
    `clock = ${CLOCK[t.clockSource] || t.clockSource}, tracker confidence ${pct(t.detectorScore ?? 0)}` +
    (t.isMusic >= 0.5 ? ", music detected" : ", no music detected")
  );

  lines.push(
    e.modelKeepingUp
      ? `Engine: keeping up (inference ${f2(e.splitterTimeMs)}ms of a ${f2(e.frameIntervalMs)}ms budget).`
      : `Engine: FALLING BEHIND - inference is taking ${f2(e.splitterTimeMs)}ms against a ` +
        `${f2(e.frameIntervalMs)}ms frame. Frames are being dropped, which shows up as erratic, ` +
        `stuttering modulator output. Close other heavy apps or reduce the workload.`
  );

  const outs = Object.entries(state.outputs || {});
  if (outs.length === 0) {
    lines.push(`Outputs: none configured, so nothing is being transmitted.`);
  } else {
    lines.push(`Outputs (${outs.length}):`);
    for (const [id, o] of outs) {
      const errs = Number(o.sendErrors || 0);
      const sent = Number(o.packetsSent || 0);
      let verdict;
      if (errs > 0) {
        verdict = `${errs} SEND ERRORS (last errno ${o.lastSendErrno}) - AudioSlice cannot reach ` +
          `that address. Check the destination IP and port, and that the machine is reachable.`;
      } else if (sent === 0) {
        verdict = `nothing sent yet - either just created, or every modulator on it has an empty OSC path.`;
      } else {
        verdict = `${sent} packets sent, no errors - AudioSlice's side is healthy. If the receiver ` +
          `shows nothing, the problem is downstream (wrong address/port, or it is not listening).`;
      }
      lines.push(`  [${id}] ${o.name}: ${verdict}`);
    }
  }
  return lines.join("\n");
}

export function formatSignals(sig) {
  const lines = [
    `Raw model output over the last ${sig.windowMs}ms, before any modulator processing.`,
    `This is the source material - what you could drive things with.`,
    ``,
  ];
  const rows = [];
  for (const [idx, s] of Object.entries(sig.stems || {})) {
    const e = s.energy || {};
    if (!Number.isFinite(e.max)) continue;
    const active = e.max > 0.02;
    const fires = s.onset ? s.onset.riseCount : e.riseCount;
    rows.push({
      idx: Number(idx),
      name: s.name || stemName(Number(idx)),
      avail: (s.available || []).join(", "),
      max: e.max, mean: e.mean, sd: e.stddev, fires, active,
    });
  }
  rows.sort((a, b) => b.max - a.max);

  for (const r of rows) {
    const state = !r.active
      ? "silent"
      : r.sd < 0.02
        ? `steady at ${f2(r.mean)} (little movement - poor modulation source)`
        : `peak ${f2(r.max)}, avg ${f2(r.mean)}, ${r.fires} hits`;
    lines.push(`  ${r.name.padEnd(15)} ${state}`);
    lines.push(`  ${"".padEnd(15)} streams: ${r.avail}`);
  }
  lines.push("");
  lines.push(
    `"streams" lists what each stem actually carries. Asking for a stream a stem does not have ` +
    `(e.g. pitch on drums) produces silence with no error, so pick from these. The one ` +
    `exception is onset: asking for it on a stem with no onsets falls back to energy, so you ` +
    `get a live signal rather than a dead modulator - but not the one you asked for.`
  );
  return lines.join("\n");
}

export function formatActivity(act, label) {
  const lines = [`Modulator ${label} -> ${act.path || "(no OSC path set!)"}`];
  if (!act.path) {
    lines.push(
      `  This modulator has no OSC path, so it processes audio and transmits nothing. ` +
      `It reports no error - set "path" to fix it.`
    );
  }
  if (act.enabled === false) lines.push(`  DISABLED - it will not send even with a path set.`);
  lines.push(`  Over the last ${act.windowMs}ms (${act.sampleCount} frames):`);
  lines.push(`    fired ${act.riseCount} times, peak ${f3(act.max)}, avg ${f3(act.mean)}, spread ${f3(act.stddev)}`);
  lines.push(`    instantaneous value right now: ${f3(act.current)}`);
  if (act.riseCount > 0 && act.current < 0.001) {
    lines.push(
      `  This is working. A near-zero "current" is expected for beat and onset sources - the value ` +
      `is non-zero for roughly one frame in 86, so a snapshot almost always catches a zero. ` +
      `The ${act.riseCount} events in the window are what matter.`
    );
  } else if (act.riseCount === 0 && act.max < 0.001) {
    lines.push(
      `  Not producing anything. Either the source stem is silent, the threshold is above the ` +
      `signal, or the stream selected does not exist for that stem.`
    );
  }
  return lines.join("\n");
}

export function formatOutputs(outputs) {
  const lines = [];
  for (const o of Object.values(outputs || {})) {
    const mods = Object.values(o.modulators || {});
    lines.push(`[${o.id}] "${o.name}"  ->  ${o.ipAddress}:${o.port}  every ${o.sendInterval}ms` +
      (o.sendBeat ? `, sending beat/tempo` : ""));
    if (mods.length === 0) {
      lines.push(`     (no modulators - this output sends nothing)`);
      continue;
    }
    for (const m of mods) {
      const bits = [`stem ${stemName(m.sourceIndex)}`];
      if (m.stemMode && m.stemMode !== 1) bits.push(`stream ${m.stemMode}`);
      if (m.beatModulo > 1) bits.push(`every ${m.beatModulo} beats`);
      if (m.beatPhaseOffsetFrames > 0) bits.push(`+${m.beatPhaseOffsetFrames}fr offset`);
      if (m.switchMode) bits.push("switch mode");
      if (m.envEnable) bits.push("envelope");
      if (m.alpha > 0 && m.alpha < 1) bits.push(`smoothing ${Math.round(alphaToMs(m.alpha))}ms`);
      if (m.envThreshold > 0) bits.push(`threshold ${m.envThreshold}`);
      if (!m.enabled) bits.push("DISABLED");
      const path = m.path ? m.path : "*** NO OSC PATH - sends nothing ***";
      lines.push(`     [${m.id}] ${path}  (${bits.join(", ")})`);
    }
  }
  return lines.length ? lines.join("\n") : "No outputs configured.";
}

/**
 * Render documentation hits. Leads with where each passage came from, so an
 * answer built from these can cite a page the user can actually go and read
 * rather than presenting the docs as the assistant's own recollection.
 */
export function formatDocHits(hits, query) {
  if (!hits.length) {
    return `Nothing in the AudioSlice documentation matches "${query}". Try fewer or more ` +
      `common words, or read_doc a page in full.`;
  }
  const out = [`AudioSlice documentation matching "${query}":`, ``];
  for (const h of hits) {
    const where = h.heading ? `${h.page} > ${h.heading}` : h.page;
    out.push(`--- ${where}  (read_doc: ${h.slug})`);
    out.push(h.text.length > 1200 ? h.text.slice(0, 1200).trimEnd() + "\n[...]" : h.text);
    out.push(``);
  }
  out.push(`These are the shipped docs for this version. For live configuration values, use the`);
  out.push(`other tools - the docs describe how things work, not what is currently set up.`);
  return out.join("\n");
}

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
      ? `Engine: keeping up.`
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
  if (e.blackout) {
    lines.push(`Blackout: ON - all OSC output is silenced at user request.`);
  }
  const lic = state.license;
  if (lic) {
    lines.push(licenseLine(lic));
  }
  return lines.join("\n");
}

// state.license: type retail | beta | trial | unlicensed | unmanaged; expired = output is off.
function licenseLine(lic) {
  if (lic.type === "unmanaged") {
    return `License: not checked in this run (a development build or a test run), so output is not limited.`;
  }
  if (lic.expired) {
    return `License: OSC output is OFF - ${lic.message || "there is no valid license."} ` +
      `Call get_license_status for details.`;
  }
  if (lic.type === "trial") return `License: free trial, ${lic.daysRemaining ?? "unknown"} day(s) remaining.`;
  if (lic.type === "beta") return `License: AudioSlice Beta, activated.`;
  if (lic.type === "retail") return `License: activated.`;
  return `License: ${lic.message || lic.type}`;
}

// --- license (VJ Lab Cloud) -------------------------------------------------

const PRODUCT = { audioslice: "AudioSlice", "audioslice-beta": "AudioSlice Beta", beatsage: "BeatSage" };
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);

export const LICENSING_OFF =
  "Licensing is off in this run of AudioSlice (a development build, or a run started to play a " +
  "file for testing), so output is not limited and there is no license to check.";

/** get_account / check_for_updates before this computer has a license: there's no account to ask about. */
export const NO_LICENSE_YET =
  "This copy of AudioSlice isn't set up yet: it has no trial or serial, so there is no VJ Lab account " +
  "to look up and no updates to check. AudioSlice's welcome screen asks for an email, then a serial " +
  "or the free trial.";

/** GET /api/v1/license */
export function formatLicense(l) {
  if (l.state === "unmanaged") return LICENSING_OFF;
  const product = PRODUCT[l.product] || "AudioSlice";
  const state = {
    none: "not set up yet - AudioSlice is showing its welcome screen, which asks for an email and then " +
      "a serial or the free trial",
    trial: `free trial, ${l.trial_days_left ?? "unknown"} day(s) left`,
    licensed: "activated with a serial",
    blocked: `not valid (${l.problem || "unknown reason"})`,
  }[l.state] || l.state;
  const lines = [
    `${product}${l.app_version ? ` ${l.app_version}` : ""}: ${state}.`,
    `OSC output: ${l.output_allowed ? "allowed" : "OFF"}.`,
  ];
  if (l.message) lines.push(`AudioSlice shows the user: "${l.message}"`);
  if (l.email) lines.push(`Email: ${l.email}`);
  if (l.serial) lines.push(`Serial: ${l.serial}${l.tier ? ` (${l.tier})` : ""}`);
  if (l.state === "trial" && l.expires_at) lines.push(`Trial ends: ${day(l.expires_at)}`);
  if (l.state !== "trial" && l.expires_at) lines.push(`Serial expires: ${day(l.expires_at)}`);
  if (l.updates_until) {
    lines.push(`New versions included until ${day(l.updates_until)}. Versions released before then keep ` +
      `working; later ones need a renewal.`);
  } else if (l.state === "licensed") {
    lines.push(`New versions: all included.`);
  }
  if (l.change_pending) {
    lines.push(`VJ Lab sent a change that applies the next time AudioSlice starts (access never changes ` +
      `in the middle of a session).`);
  }
  if (l.reminder) {
    lines.push(`AudioSlice has not confirmed this license online for a long time. It keeps working; ` +
      `connecting to the internet once refreshes it.`);
  }
  return lines.join("\n");
}

/** POST /api/v1/license/refresh: {status, message, detail, license} */
export function formatLicenseResult(r) {
  const head = r.status === "ok" ? "VJ Lab confirmed the license." : `VJ Lab's answer: ${r.status}. ${r.message || ""}`;
  return `${head}\n\n${formatLicense(r.license || {})}`;
}

/** GET /api/v1/license/account, with GET /api/v1/license for which serial this copy uses. */
export function formatAccount(acc, lic) {
  const serials = acc.serials || [];
  const lines = [`Account: ${acc.email} (${serials.length} serial${serials.length === 1 ? "" : "s"}).`];
  if (acc.account_url) {
    lines.push(`The user manages it at ${acc.account_url} (signs in with an emailed link): remove a ` +
      `computer, download, renew, or have the serials emailed again.`);
  }
  for (const s of serials) {
    lines.push(``);
    const mine = lic && s.serial === lic.serial ? "  <- this copy of AudioSlice" : "";
    lines.push(`${s.serial}: ${PRODUCT[s.product] || s.product}, ${s.tier}, ${s.status}${mine}`);
    if (s.tier === "trial" && s.trial_days_left != null) lines.push(`  Trial: ${s.trial_days_left} day(s) left`);
    const ms = s.machines || [];
    lines.push(`  Computers: ${ms.length} of ${s.max_machines ?? "unlimited"}` +
      (ms.length ? ` - ${ms.map((m) => `${m.machine_name || "unnamed"} (last seen ${day(m.last_seen_at) || "never"})`).join(", ")}` : ""));
    if (s.updates_until) {
      lines.push(`  New versions included until ${day(s.updates_until)}` +
        (s.updates_days_left > 0 ? ` (${s.updates_days_left} days left)` : ` (ended)`) +
        (s.newest_covered_version ? `; newest covered version ${s.newest_covered_version}` : ""));
    }
    if (s.newer_versions_not_covered > 0) lines.push(`  Newer releases exist that need a renewal.`);
    for (const r of s.latest || []) {
      lines.push(`  Download for ${r.platform}: ${r.version} (${r.build_date}) ${r.url}`);
    }
    if (s.refund_status) lines.push(`  Refund: ${s.refund_status}`);
  }
  return lines.join("\n");
}

function cmpVersion(a, b) {
  const x = String(a).split(/[.-]/), y = String(b).split(/[.-]/);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (parseInt(x[i] || "0", 10) || 0) - (parseInt(y[i] || "0", 10) || 0);
    if (d) return d;
  }
  return 0;
}

/** check_for_updates: the account's releases for this copy's serial, against the running version. */
export function formatUpdates(acc, lic, platform) {
  const serials = acc.serials || [];
  const s = serials.find((x) => x.serial === lic.serial) || serials.find((x) => x.product === lic.product);
  const running = lic.app_version;
  if (!s) return `This license's serial was not found on the account, so there is nothing to compare. Running: ${running || "unknown"}.`;
  const latest = (s.latest || []).find((r) => r.platform === platform);
  const lines = [`Running: ${PRODUCT[s.product] || s.product} ${running || "(version unknown)"} on ${platform}.`];
  if (!latest) {
    lines.push(`No ${platform} release covered by this license is published yet.`);
  } else if (running && cmpVersion(latest.version, running) > 0) {
    lines.push(`Update available: ${latest.version} (released ${latest.build_date}), covered by this license. ` +
      `Download: ${latest.url}`);
  } else {
    lines.push(`Up to date: ${latest.version} is the newest ${platform} version this license covers.`);
  }
  if (s.newer_versions_not_covered > 0) {
    lines.push(`Newer releases exist that this license does not cover: its update period ended ` +
      `${day(s.updates_until)}. They need a renewal${acc.account_url ? ` (${acc.account_url})` : ""}.`);
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
      if (m.beatModulo > 1) bits.push(`every ${m.beatModulo} beats (${m.beatCountOffset === 0 ? "skip first" : "fire first"})`);
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

export function formatMidiDevices(midi) {
  const enabled = Boolean(midi.enabled);
  const running = Boolean(midi.running);
  const curName = midi.deviceName || "";
  const curId = midi.deviceIdentifier || "";
  const avail = midi.availableDevices || [];

  const statusBits = [enabled ? "ENABLED" : "DISABLED"];
  if (enabled) {
    statusBits.push(running ? "listening" : "not open");
  }
  const lines = [
    `MIDI control: ${statusBits.join(", ")}`,
    `Selected device: ${curName ? `${curName}${curId ? ` [${curId}]` : ""}` : "(none)"}`,
    ``,
  ];

  if (avail.length === 0) {
    lines.push(`Available MIDI input devices: (none connected)`);
  } else {
    lines.push(`Available MIDI input devices (${avail.length}):`);
    for (const d of avail) {
      const marker = d.selected ? "   <- selected" : "";
      lines.push(`  ${d.name}  [identifier: ${d.identifier}]${marker}`);
    }
  }
  return lines.join("\n");
}

export function formatMidiBindings(midi) {
  const enabled = Boolean(midi.enabled);
  const curName = midi.deviceName || "(none)";
  const lines = [
    `MIDI control: ${enabled ? "ENABLED" : "DISABLED"} (device: ${curName})`,
    ``,
    `Controllable functions:`,
  ];
  const fns = Object.entries(midi.functions || {});
  if (fns.length === 0) {
    lines.push(`  (none reported)`);
    return lines.join("\n");
  }
  for (const [key, f] of fns) {
    const label = f.name ? `${key} ("${f.name}")` : key;
    if (!f.assigned) {
      lines.push(`  ${label.padEnd(36)} unassigned`);
    } else if (f.isCC || f.type === "cc") {
      lines.push(`  ${label.padEnd(36)} Ch ${f.channel}, CC ${f.number}`);
    } else {
      const noteLabel = f.noteName ? `${f.noteName} (note ${f.number})` : `Note ${f.number}`;
      lines.push(`  ${label.padEnd(36)} Ch ${f.channel}, ${noteLabel}`);
    }
  }
  return lines.join("\n");
}

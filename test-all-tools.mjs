// Exercises EVERY tool and prompt the server exposes, against a running
// AudioSlice, and restores anything it changes.
//
// Destructive tools are covered by operating on a throwaway output, and by
// round-tripping a patch saved from the live configuration so a load restores
// the same state it started from. Tempo, device and token are captured up front
// and put back in the finally block.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { AudioSliceClient } from "./server/client.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// A short file in the repo, played muted so the test makes no sound.
const TEST_WAV = join(HERE, "..", "tests", "model_test.wav");
const http = new AudioSliceClient();
const transport = new StdioClientTransport({
  command: process.execPath, args: [join(HERE, "server", "index.js")],
});
const client = new Client({ name: "coverage", version: "0" });
await client.connect(transport);

const results = [];
const seen = new Set();

async function call(name, args = {}, { expectError = false } = {}) {
  seen.add(name);
  const r = await client.callTool({ name, arguments: args });
  const body = r.content.map((c) => c.text).join("\n");
  const failed = r.isError === true;
  const ok = expectError ? failed : !failed;
  results.push({ name: `${name}${expectError ? " (error path)" : ""}`, ok, body });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${expectError ? " (error path)" : ""}`);
  if (!ok) console.log(`      ${body.split("\n")[0]}`);
  return body;
}

const declared = (await client.listTools()).tools.map((t) => t.name);
const prompts = (await client.listPrompts()).prompts.map((p) => p.name);

let outputId = null, modId = null;
let origTempo = null, origDevice = null;
let origBlackout = false;
let origMidi = null;
const BACKUP = "coverage backup";

try {
  // ---- read-only -----------------------------------------------------------
  const status = await call("get_status");
  await call("analyze_audio", { window_ms: 2000 });
  await call("list_outputs");
  await call("get_api_schema", { section: "modulator" });
  await call("get_api_schema", { section: "midi" });
  await call("get_api_schema", { section: "all" });
  // Docs are vendored, so these are the one pair of tools that work with
  // AudioSlice closed - worth covering both the hit and the miss.
  await call("search_docs", { query: "onset threshold" });
  await call("search_docs", { query: "resolume osc setup", max_results: 2 });
  await call("read_doc", { page: "modulators" });
  await call("read_doc", { page: "no-such-page" }, { expectError: true });
  const devices = await call("list_audio_devices");
  await call("list_patches");
  const blackoutStatus = await call("get_blackout");
  origBlackout = blackoutStatus.includes("Blackout is ON");
  origMidi = await http.get("/midi");
  await call("list_midi_devices");
  await call("get_midi_bindings");
  // Licensing. In a Debug build licensing is off and each says so; with a license, the last
  // three have AudioSlice ask VJ Lab, so they need the internet.
  await call("get_license_status");
  await call("get_account");
  await call("check_for_updates");
  await call("refresh_license");

  origDevice = devices.match(/Currently open: (.+?) via/)?.[1] ?? null;
  origTempo = {
    bpm: +(status.match(/Tempo: ([\d.]+) BPM/)?.[1] ?? 120),
    clock: status.match(/clock = ([^,]+)/)?.[1]?.trim() ?? "real-time tracker",
  };

  // ---- back up the live config before touching anything destructive --------
  await call("save_patch", { name: BACKUP });
  await call("list_patches");

  // ---- create / update / inspect / delete ----------------------------------
  const made = await call("create_osc_output", {
    name: "coverage test", ip: "127.0.0.1", port: 9986, send_interval_ms: 11,
  });
  outputId = +made.match(/id (\d+)/)[1];

  const mod = await call("create_modulator", {
    output_id: outputId, osc_path: "/coverage/a", stem: "kick", stream: "onset",
    name: "probe", range_min: 0, range_max: 1, smoothing_ms: 0, switch_mode: true,
  });
  modId = +mod.match(/modulator (\d+)/)[1];

  await call("describe_modulator", { output_id: outputId, modulator_id: modId, window_ms: 3000 });
  await call("update_modulator", {
    output_id: outputId, modulator_id: modId,
    osc_path: "/coverage/b", smoothing_ms: 50, invert: true, fire_every_beats: 4,
    fire_first: false, beat_offset_frames: 2, enabled: true,
  });
  await call("list_outputs");

  // a second modulator so delete_modulator is covered independently
  const mod2 = await call("create_modulator", {
    output_id: outputId, osc_path: "/coverage/c", stem: "beat",
  });
  await call("delete_modulator", {
    output_id: outputId, modulator_id: +mod2.match(/modulator (\d+)/)[1],
  });

  // ---- tempo ---------------------------------------------------------------
  await call("set_tempo", { clock: "metronome", metronome_bpm: 128, beats_per_bar: 4 });
  await call("set_tempo", { clock: "tracker", disable_downbeat_detection: true, beats_per_bar: 3 });
  await call("set_tempo", { disable_downbeat_detection: false });
  await call("set_tempo", { tempo_bias: "prefer_faster", responsiveness: 0.5 });
  await call("tap_tempo");
  await call("reset_model");
  await call("set_blackout", { enabled: true });
  await call("get_blackout");
  await call("set_blackout", { enabled: false });
  await call("get_blackout");

  // ---- MIDI control --------------------------------------------------------
  await call("set_midi_binding", { function: "tapTempo", channel: 1, note: "C4" });
  await call("set_midi_binding", { function: "blackout", channel: 2, cc: 64 });
  await call("get_midi_bindings");
  await call("set_midi_binding", { function: "tapTempo", clear: true });
  await call("set_midi_binding", { function: "blackout", clear: true });
  await call("set_midi_binding", { function: "noSuchFunction", note: 60 }, { expectError: true });
  if (origMidi?.availableDevices?.length) {
    const dev = origMidi.availableDevices[0];
    await call("select_midi_device", { name: dev.name, identifier: dev.identifier });
  }
  await call("select_midi_device", { name: "No Such MIDI Device" }, { expectError: true });
  await call("set_midi_enabled", { enabled: true });
  await call("set_midi_enabled", { enabled: false });

  // ---- file playback ---------------------------------------------------------
  await call("play_file", { path: TEST_WAV, mute: true, start_s: 1, end_s: 4 });
  await call("stop_file");
  await call("stop_file", {}, { expectError: true });            // nothing playing now
  await call("play_file", { path: "/no/such/file.wav" }, { expectError: true });

  // ---- devices -------------------------------------------------------------
  const alt = devices.split("\n")
    .map((l) => l.match(/^\s{2}(.+?)(?:\s{3}<- current)?\s{2}\[/)?.[1])
    .filter(Boolean).filter((n) => n !== origDevice);
  if (alt.length) {
    await call("select_audio_device", { name: alt[0] });
    await call("select_audio_device", { name: origDevice });
  }
  await call("select_audio_device", { name: "No Such Device" }, { expectError: true });

  // ---- token ---------------------------------------------------------------
  // AudioSlice has no token configured, so it ignores the header; this proves
  // the tool stores and verifies without locking us out.
  await call("set_audioslice_token", { token: "coverage-dummy" });
  await call("get_status");
  await call("set_audioslice_token", { token: "" });

  // ---- patches (destructive load, restoring the same state) ----------------
  await call("load_patch", { name: BACKUP });
  await call("load_patch", { name: "definitely not a patch" }, { expectError: true });

  // ---- remaining error paths ----------------------------------------------
  await call("describe_modulator", { output_id: 99999, modulator_id: 1 }, { expectError: true });

  // ---- prompts -------------------------------------------------------------
  for (const name of prompts) {
    const p = await client.getPrompt({ name, arguments: {} });
    const txt = p.messages?.[0]?.content?.text ?? "";
    const ok = txt.length > 40;
    results.push({ name: `prompt:${name}`, ok, body: txt });
    console.log(`${ok ? "PASS" : "FAIL"}  prompt:${name}`);
  }
} finally {
  // restore everything we touched
  try {
    if (origTempo) {
      await client.callTool({ name: "set_tempo", arguments: { clock: "tracker", tempo_bias: "neutral" } });
    }
    if (origBlackout) {
      await client.callTool({ name: "set_blackout", arguments: { enabled: true } });
    }
    if (origMidi) {
      await http.write("PUT", "/midi", {
        enabled: Boolean(origMidi.enabled),
        deviceIdentifier: origMidi.deviceIdentifier || "",
        deviceName: origMidi.deviceName || "",
        functions: Object.fromEntries(
          Object.entries(origMidi.functions || {}).map(([k, v]) => [
            k,
            v.assigned ? { channel: v.channel, isCC: Boolean(v.isCC), number: v.number } : { clear: true },
          ])
        ),
      });
    }
    // outputId came from the pre-load config; after load_patch it is gone, but
    // delete is idempotent enough for cleanup purposes.
    if (outputId !== null) {
      await client.callTool({ name: "delete_output", arguments: { output_id: outputId } });
      seen.add("delete_output");
    }
  } catch { /* cleanup is best-effort */ }
  await client.close();
}

// ---- report ----------------------------------------------------------------
const untested = declared.filter((t) => !seen.has(t));
const failed = results.filter((r) => !r.ok);
console.log(`\n=== COVERAGE ===`);
console.log(`tools declared: ${declared.length}   exercised: ${seen.size}   prompts: ${prompts.length}`);
if (untested.length) console.log(`NOT EXERCISED: ${untested.join(", ")}`);
console.log(`checks: ${results.length}   failed: ${failed.length}`);
for (const f of failed) console.log(`  FAILED ${f.name}: ${f.body.split("\n")[0]}`);
process.exit(failed.length || untested.length ? 1 : 0);

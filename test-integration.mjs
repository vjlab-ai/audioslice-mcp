// Integration test: exercises every tool and every declared argument against a
// running AudioSlice, then puts the configuration back.
//
// Run via ./run_build.sh --run-tests, or directly with `node mcp/test-integration.mjs`.
//
// The argument matrix is derived from the schemas the server actually declares
// rather than hand-listed, so adding an argument without testing it fails this
// suite instead of going unnoticed. That is the whole point: the tools are the
// contract, and an untested argument is an untested contract.
//
// Exit codes:  0 pass   1 failures   2 skipped (AudioSlice not reachable)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH_PATCH = "integration test backup";
const SCRATCH_OSC_PATH = "/integration/test";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(HERE, "server", "index.js")],
});
const client = new Client({ name: "integration", version: "0" });
await client.connect(transport);

const tools = (await client.listTools()).tools;
const prompts = (await client.listPrompts()).prompts;
const schemaOf = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema?.properties || {}]));

const results = [];
const exercised = new Set(); // "tool.arg" pairs actually sent

function record(label, ok, detail = "") {
  results.push({ label, ok, detail });
  process.stdout.write(`${ok ? "  PASS  " : "  FAIL  "}${label}\n`);
  if (!ok && detail) process.stdout.write(`          ${detail.split("\n")[0]}\n`);
}

/** Call a tool and record the outcome. `expect: "error"` inverts the check. */
async function call(name, args = {}, { expect = "ok", label } = {}) {
  for (const k of Object.keys(args)) exercised.add(`${name}.${k}`);
  const shown = label || `${name}(${Object.keys(args).join(", ") || "-"})`;
  let r, threw = null;
  try {
    r = await client.callTool({ name, arguments: args });
  } catch (e) {
    // A schema rejection surfaces as a thrown protocol error rather than isError.
    threw = e;
  }
  const failed = threw !== null || r?.isError === true;
  const body = threw ? String(threw.message) : r.content.map((c) => c.text).join("\n");
  record(shown, expect === "error" ? failed : !failed, body);
  return body;
}

// ---------------------------------------------------------------------------
// Preflight: a machine with no AudioSlice running is a skip, not a failure.
// ---------------------------------------------------------------------------
const probe = await client.callTool({ name: "get_status", arguments: {} });
if (probe.isError) {
  console.log("\nSKIPPED: AudioSlice is not reachable.");
  console.log(probe.content.map((c) => c.text).join("\n").split("\n")[0]);
  await client.close();
  process.exit(2);
}

console.log(`\nMCP integration test — ${tools.length} tools, ${prompts.length} prompts\n`);

let outputId = null;
let modId = null;
let restored = false;

try {
  // --- read-only ------------------------------------------------------------
  console.log("read-only");
  await call("get_status");
  await call("analyze_audio");
  await call("analyze_audio", { window_ms: 2000 });
  await call("list_outputs");
  await call("list_patches");
  await call("list_audio_devices");

  // Every documentation page, and every schema section: these are enums, so the
  // cheap thing to do is cover the whole set rather than one representative.
  const pages = schemaOf.read_doc?.page?.enum || [];
  for (const page of pages) await call("read_doc", { page }, { label: `read_doc(${page})` });
  record("read_doc covers every declared page", pages.length >= 12, `saw ${pages.length}`);

  const sections = schemaOf.get_api_schema?.section?.enum || [];
  for (const section of sections) {
    await call("get_api_schema", { section }, { label: `get_api_schema(${section})` });
  }

  await call("search_docs", { query: "onset threshold" });
  await call("search_docs", { query: "resolume", max_results: 1 });
  await call("search_docs", { query: "tempo", max_results: 10 });

  // --- schema rejection -----------------------------------------------------
  console.log("\nschema rejection");
  await call("read_doc", { page: "no-such-page" }, { expect: "error" });
  await call("get_api_schema", { section: "nonsense" }, { expect: "error" });
  await call("search_docs", { query: "x", max_results: 99 }, { expect: "error" });
  await call("create_modulator", { output_id: 0, osc_path: "/x", stem: "not_a_stem" }, { expect: "error" });
  await call("set_tempo", { metronome_bpm: 9999 }, { expect: "error" });
  await call("describe_modulator", { output_id: 99999, modulator_id: 1 }, { expect: "error" });
  await call("select_audio_device", { name: "No Such Device" }, { expect: "error" });

  // --- back up before touching anything -------------------------------------
  console.log("\nbacking up the live configuration");
  await call("save_patch", { name: SCRATCH_PATCH });

  // --- create / update / inspect --------------------------------------------
  console.log("\nmutating (on a throwaway output)");
  const made = await call("create_osc_output", {
    name: "integration test",
    ip: "127.0.0.1",
    port: 9999,
    send_interval_ms: 20,
  });
  // "with id N" - not the first number in the line, which is part of the IP.
  outputId = Number(made.match(/with id (\d+)/)?.[1] ?? NaN);
  record("parsed the new output id", Number.isFinite(outputId), made);

  if (Number.isFinite(outputId)) {
    // Every declared create_modulator argument in one call, so the matrix below
    // sees them all exercised. Values are chosen to be individually valid.
    const createArgs = {
      output_id: outputId,
      osc_path: SCRATCH_OSC_PATH,
      stem: "kick",
      stream: "onset",
      name: "integration",
      range_min: 0,
      range_max: 1,
      smoothing_ms: 0,
      fire_every_beats: 1,
      beat_offset_frames: 0,
      switch_mode: true,
    };
    // threshold exists only where the onset-threshold work has landed; include it
    // when declared so this suite covers it there without failing here.
    if (schemaOf.create_modulator?.threshold) createArgs.threshold = 0.15;
    const mod = await call("create_modulator", createArgs);
    modId = Number(mod.match(/Created modulator (\d+)/)?.[1] ?? NaN);
    record("parsed the new modulator id", Number.isFinite(modId), mod);

    if (Number.isFinite(modId)) {
      await call("describe_modulator", { output_id: outputId, modulator_id: modId, window_ms: 3000 });

      const updateArgs = {
        output_id: outputId,
        modulator_id: modId,
        osc_path: SCRATCH_OSC_PATH + "/2",
        enabled: true,
        stem: "snare",
        stream: "onset",
        range_min: 0,
        range_max: 127,
        smoothing_ms: 20,
        fire_every_beats: 2,
        beat_offset_frames: 1,
        switch_mode: false,
        invert: false,
      };
      if (schemaOf.update_modulator?.threshold) updateArgs.threshold = 0.2;
      await call("update_modulator", updateArgs);

      await call("delete_modulator", { output_id: outputId, modulator_id: modId });
      modId = null;
    }
  }

  // --- tempo, devices, token ------------------------------------------------
  console.log("\ntempo / devices / token");
  await call("set_tempo", { clock: "metronome", metronome_bpm: 128, beats_per_bar: 4 });
  await call("set_tempo", { tempo_bias: "prefer_faster" });
  await call("set_tempo", { clock: "tracker", tempo_bias: "neutral" });
  await call("tap_tempo");

  // Only ever re-select the device that is already open. Switching someone's audio
  // device from a test would be a real change to their machine, not a test fixture.
  const devices = await call("list_audio_devices");
  const currentLine = devices.split("\n").find((l) => l.includes("<- current"));
  const current = currentLine
    ? {
        name: currentLine.replace("<- current", "").replace(/\[[^\]]*\]\s*$/, "").trim(),
        type: currentLine.match(/\[([^\]]+)\]\s*$/)?.[1],
      }
    : null;
  if (current?.name) {
    await call("select_audio_device", { name: current.name });
    if (current.type) await call("select_audio_device", { name: current.name, type: current.type });
  } else {
    record("found the current audio device to re-select", false, devices.split("\n")[0]);
  }

  await call("set_audioslice_token", { token: "integration-dummy" });
  await call("set_audioslice_token", { token: "" });

  // --- prompts --------------------------------------------------------------
  console.log("\nprompts");
  for (const p of prompts) {
    try {
      const got = await client.getPrompt({ name: p.name, arguments: {} });
      record(`prompt ${p.name}`, (got.messages?.length || 0) > 0);
    } catch (e) {
      record(`prompt ${p.name}`, false, e.message);
    }
  }
} catch (e) {
  record("suite aborted", false, e.message);
} finally {
  console.log("\nrestoring");
  try {
    if (outputId !== null) {
      await client.callTool({ name: "delete_output", arguments: { output_id: outputId } });
      exercised.add("delete_output.output_id");
    }
    await client.callTool({ name: "load_patch", arguments: { name: SCRATCH_PATCH } });
    exercised.add("load_patch.name");
    restored = true;
  } catch (e) {
    console.log(`  WARNING: could not restore automatically: ${e.message}`);
    console.log(`  The configuration is saved as the patch "${SCRATCH_PATCH}".`);
  }
  record("configuration restored", restored);
}

// ---------------------------------------------------------------------------
// Coverage: every declared argument must have been sent at least once.
// ---------------------------------------------------------------------------
const declaredArgs = tools.flatMap((t) => Object.keys(schemaOf[t.name]).map((a) => `${t.name}.${a}`));
const untestedArgs = declaredArgs.filter((a) => !exercised.has(a));
const untestedTools = tools.map((t) => t.name).filter((n) => ![...exercised].some((e) => e.startsWith(n + ".")) && Object.keys(schemaOf[n]).length > 0);

console.log("\n" + "=".repeat(64));
const failed = results.filter((r) => !r.ok);
console.log(`checks   ${results.length - failed.length}/${results.length} passed`);
console.log(`arguments ${declaredArgs.length - untestedArgs.length}/${declaredArgs.length} exercised`);
if (untestedArgs.length) console.log(`\nNOT EXERCISED: ${untestedArgs.join(", ")}`);
if (untestedTools.length) console.log(`TOOLS NOT REACHED: ${untestedTools.join(", ")}`);
if (failed.length) {
  console.log(`\nFAILURES:`);
  for (const f of failed) console.log(`  ${f.label}\n    ${f.detail.split("\n")[0]}`);
}
console.log("=".repeat(64));

await client.close();
process.exit(failed.length || untestedArgs.length ? 1 : 0);

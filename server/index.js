#!/usr/bin/env node
// AudioSlice MCP server.
//
// Talks to a locally running AudioSlice over its localhost HTTP control API.
// Makes no outbound network calls of any kind: the user documentation is vendored
// into docs/ at build time by sync-docs.mjs and read from disk, so this behaves
// identically with or without an internet connection - which matters at a venue.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";

import { AudioSliceClient } from "./client.js";
import { stemIndex, streamId, stemName, msToAlpha, STEMS, STREAMS } from "./stems.js";
import { formatStatus, formatSignals, formatActivity, formatOutputs, formatDocHits } from "./format.js";
import { searchDocs, readDoc, pageList, docsAvailable } from "./docs.js";
import { TOOLS, PROMPTS } from "./descriptions.js";

// descriptions.js is prose, so the lists that have to stay in step with the code -
// stem names, stream names, the vendored doc pages - appear there as tokens rather
// than as text somebody has to remember to update. Filled in here, once, at
// registration.
const FILL = {
  "{{STEMS}}": () => STEMS.join(", "),
  "{{STREAMS}}": () => Object.keys(STREAMS).join(", "),
  "{{DOC_PAGES}}": () => pageList().join(", "),
};
function fill(s) {
  let out = String(s);
  for (const [token, value] of Object.entries(FILL)) {
    if (out.includes(token)) out = out.split(token).join(value());
  }
  return out;
}
// Applied to every description at registration, so a token can never reach a model
// unresolved no matter which entry it was written into.
// Enumerating the valid values in the schema, rather than only naming them in prose,
// lets a client reject a bad stem or page before it reaches AudioSlice and shows a
// model the whole set without it having to parse a sentence.
const DOC_PAGE = pageList().length ? z.enum(pageList()) : z.string();

const T = new Proxy(TOOLS, {
  get(target, name) {
    const t = target[name];
    if (!t) throw new Error(`No description entry for tool "${String(name)}"`);
    return {
      title: t.title,
      description: fill(t.description),
      args: new Proxy(t.args || {}, {
        get(a, k) {
          if (!(k in a)) throw new Error(`No description for ${String(name)}.${String(k)}`);
          return fill(a[k]);
        },
      }),
    };
  },
});

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));

const client = new AudioSliceClient();
const text = (s) => ({ content: [{ type: "text", text: s }] });
const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });

// --- token persistence ------------------------------------------------------
// A token pasted into the conversation has to outlive this process, or every
// new conversation asks again.
function tokenPath() {
  const base =
    platform() === "darwin"
      ? join(homedir(), "Library", "Application Support", "AudioSlice")
      : platform() === "win32"
        ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "AudioSlice")
        : join(homedir(), ".config", "AudioSlice");
  return join(base, "mcp-token.json");
}
try {
  if (!client.token) {
    client.setToken(JSON.parse(readFileSync(tokenPath(), "utf8")).token);
  }
} catch {
  /* no stored token yet */
}

const server = new McpServer({ name: "audioslice", version: PKG.version });

// --- read tools -------------------------------------------------------------

server.registerTool(
  "get_status",
  {
    title: T.get_status.title,
    description: T.get_status.description,
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    try {
      return text(formatStatus(await client.get("/state")));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "analyze_audio",
  {
    title: T.analyze_audio.title,
    description: T.analyze_audio.description,
    inputSchema: {
      window_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(T.analyze_audio.args.window_ms),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ window_ms }) => {
    try {
      const q = window_ms ? `?window_ms=${window_ms}` : "";
      return text(formatSignals(await client.get(`/signals${q}`)));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "list_outputs",
  {
    title: T.list_outputs.title,
    description: T.list_outputs.description,
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    try {
      const r = await client.get("/outputs");
      return text(formatOutputs(r.outputs || r));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "describe_modulator",
  {
    title: T.describe_modulator.title,
    description: T.describe_modulator.description,
    inputSchema: {
      output_id: z.number().int().describe(T.describe_modulator.args.output_id),
      modulator_id: z.number().int().describe(T.describe_modulator.args.modulator_id),
      window_ms: z.number().int().positive().optional().describe(T.describe_modulator.args.window_ms),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ output_id, modulator_id, window_ms }) => {
    try {
      const q = window_ms ? `?window_ms=${window_ms}` : "";
      const act = await client.get(`/outputs/${output_id}/modulators/${modulator_id}/activity${q}`);
      return text(formatActivity(act, `${output_id}/${modulator_id}`));
    } catch (e) {
      return fail(e);
    }
  }
);

// --- documentation ----------------------------------------------------------
// The product docs, vendored from the docs site at build time. get_api_schema
// below answers "what is this field"; these answer "how does this work" and
// "how do I wire it to Resolume" - which the field reference cannot.

server.registerTool(
  "search_docs",
  {
    title: T.search_docs.title,
    description: T.search_docs.description,
    inputSchema: {
      query: z.string().describe(T.search_docs.args.query),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe(T.search_docs.args.max_results),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ query, max_results }) => {
    if (!docsAvailable) {
      return fail(new Error(
        "The bundled documentation is missing from this install. The other tools are unaffected."
      ));
    }
    return text(formatDocHits(searchDocs(query, max_results || 5), query));
  }
);

server.registerTool(
  "read_doc",
  {
    title: T.read_doc.title,
    description: T.read_doc.description,
    inputSchema: {
      page: DOC_PAGE.describe(T.read_doc.args.page),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ page }) => {
    if (!docsAvailable) {
      return fail(new Error(
        "The bundled documentation is missing from this install. The other tools are unaffected."
      ));
    }
    const doc = readDoc(page);
    if (!doc) {
      return fail(new Error(`No page "${page}". Available: ${pageList().join(", ")}.`));
    }
    return text(doc.body);
  }
);

server.registerTool(
  "get_api_schema",
  {
    title: T.get_api_schema.title,
    description: T.get_api_schema.description,
    inputSchema: {
      section: z
        .enum(["modulator", "output", "settings", "tempo", "signalSummary", "statistics", "all"])
        .optional()
        .describe(T.get_api_schema.args.section),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ section }) => {
    try {
      const doc = await client.get("/schema");
      const want = section || "modulator";
      const f = doc.fields || {};
      const out = want === "all" ? f : { [want]: f[want] };
      return text(JSON.stringify(out, null, 2));
    } catch (e) {
      return fail(e);
    }
  }
);

// --- write tools ------------------------------------------------------------
// All of these go through client.write(), which serialises and paces them.
// Each mutation briefly parks AudioSlice's output thread, so a burst of edits
// would interrupt OSC repeatedly.

server.registerTool(
  "create_osc_output",
  {
    title: T.create_osc_output.title,
    description: T.create_osc_output.description,
    inputSchema: {
      name: z.string().describe(T.create_osc_output.args.name),
      ip: z.string().default("127.0.0.1").describe(T.create_osc_output.args.ip),
      port: z.number().int().min(1).max(65535).describe(T.create_osc_output.args.port),
      send_interval_ms: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe(T.create_osc_output.args.send_interval_ms),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ name, ip, port, send_interval_ms }) => {
    try {
      const r = await client.write("POST", "/outputs", {
        protocol: 0,
        name,
        ipAddress: ip,
        port,
        sendInterval: send_interval_ms ?? 11,
      });
      return text(`Created output "${name}" -> ${ip}:${port} with id ${r.id}.`);
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "create_modulator",
  {
    title: T.create_modulator.title,
    description: T.create_modulator.description,
    inputSchema: {
      output_id: z.number().int().describe(T.create_modulator.args.output_id),
      osc_path: z.string().describe(T.create_modulator.args.osc_path),
      stem: z.enum(STEMS).describe(T.create_modulator.args.stem),
      stream: z
        .enum(Object.keys(STREAMS))
        .optional()
        .describe(T.create_modulator.args.stream),
      name: z.string().optional().describe(T.create_modulator.args.name),
      range_min: z.number().min(-10000).max(10000).optional().describe(T.create_modulator.args.range_min),
      range_max: z.number().min(-10000).max(10000).optional().describe(T.create_modulator.args.range_max),
      smoothing_ms: z
        .number()
        .min(0)
        .max(10000)
        .optional()
        .describe(T.create_modulator.args.smoothing_ms),
      threshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(T.create_modulator.args.threshold),
      fire_every_beats: z
        .number()
        .int()
        .min(1)
        .max(256)
        .optional()
        .describe(T.create_modulator.args.fire_every_beats),
      beat_offset_frames: z
        .number()
        .int()
        .min(0)
        .max(64)
        .optional()
        .describe(T.create_modulator.args.beat_offset_frames),
      switch_mode: z
        .boolean()
        .optional()
        .describe(T.create_modulator.args.switch_mode),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async (a) => {
    try {
      const body = {
        path: a.osc_path,
        sourceIndex: stemIndex(a.stem),
        stemMode: a.stream ? streamId(a.stream) : 1,
        enabled: true,
      };
      if (a.name) body.name = a.name;
      if (a.range_min !== undefined) body.rangeMin = a.range_min;
      if (a.range_max !== undefined) body.rangeMax = a.range_max;
      if (a.smoothing_ms !== undefined) body.alpha = msToAlpha(a.smoothing_ms);
      if (a.threshold !== undefined) body.envThreshold = a.threshold;
      if (a.fire_every_beats !== undefined) body.beatModulo = a.fire_every_beats;
      if (a.beat_offset_frames !== undefined) body.beatPhaseOffsetFrames = a.beat_offset_frames;
      if (a.switch_mode !== undefined) body.switchMode = a.switch_mode;

      const r = await client.write("POST", `/outputs/${a.output_id}/modulators`, body);
      return text(
        `Created modulator ${r.id} on output ${a.output_id}: ${stemName(body.sourceIndex)} -> ${a.osc_path}. ` +
        `Verify it with describe_modulator(${a.output_id}, ${r.id}).`
      );
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "update_modulator",
  {
    title: T.update_modulator.title,
    description: T.update_modulator.description,
    inputSchema: {
      output_id: z.number().int().describe(T.update_modulator.args.output_id),
      modulator_id: z.number().int().describe(T.update_modulator.args.modulator_id),
      osc_path: z.string().optional().describe(T.update_modulator.args.osc_path),
      enabled: z.boolean().optional().describe(T.update_modulator.args.enabled),
      stem: z.enum(STEMS).optional().describe(T.update_modulator.args.stem),
      stream: z.enum(Object.keys(STREAMS)).optional().describe(T.update_modulator.args.stream),
      range_min: z.number().min(-10000).max(10000).optional().describe(T.update_modulator.args.range_min),
      range_max: z.number().min(-10000).max(10000).optional().describe(T.update_modulator.args.range_max),
      smoothing_ms: z.number().min(0).max(10000).optional().describe(T.update_modulator.args.smoothing_ms),
      threshold: z.number().min(0).max(1).optional().describe(T.update_modulator.args.threshold),
      fire_every_beats: z.number().int().min(1).max(256).optional().describe(T.update_modulator.args.fire_every_beats),
      beat_offset_frames: z.number().int().min(0).max(64).optional().describe(T.update_modulator.args.beat_offset_frames),
      switch_mode: z.boolean().optional().describe(T.update_modulator.args.switch_mode),
      invert: z.boolean().optional().describe(T.update_modulator.args.invert),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true },
  },
  async (a) => {
    try {
      const body = {};
      if (a.osc_path !== undefined) body.path = a.osc_path;
      if (a.enabled !== undefined) body.enabled = a.enabled;
      if (a.stem !== undefined) body.sourceIndex = stemIndex(a.stem);
      if (a.stream !== undefined) body.stemMode = streamId(a.stream);
      if (a.range_min !== undefined) body.rangeMin = a.range_min;
      if (a.range_max !== undefined) body.rangeMax = a.range_max;
      if (a.smoothing_ms !== undefined) body.alpha = msToAlpha(a.smoothing_ms);
      if (a.threshold !== undefined) body.envThreshold = a.threshold;
      if (a.fire_every_beats !== undefined) body.beatModulo = a.fire_every_beats;
      if (a.beat_offset_frames !== undefined) body.beatPhaseOffsetFrames = a.beat_offset_frames;
      if (a.switch_mode !== undefined) body.switchMode = a.switch_mode;
      if (a.invert !== undefined) body.invert = a.invert;

      if (Object.keys(body).length === 0) return text("Nothing to change - no fields were supplied.");
      await client.write("PATCH", `/outputs/${a.output_id}/modulators/${a.modulator_id}`, body);
      return text(`Updated modulator ${a.modulator_id}: ${Object.keys(body).join(", ")}.`);
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "delete_modulator",
  {
    title: T.delete_modulator.title,
    description: T.delete_modulator.description,
    inputSchema: {
      output_id: z.number().int().describe(T.delete_modulator.args.output_id),
      modulator_id: z.number().int().describe(T.delete_modulator.args.modulator_id),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
      idempotentHint: true,
    },
  },
  async ({ output_id, modulator_id }) => {
    try {
      await client.write("DELETE", `/outputs/${output_id}/modulators/${modulator_id}`);
      return text(`Deleted modulator ${modulator_id} from output ${output_id}.`);
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "delete_output",
  {
    title: T.delete_output.title,
    description: T.delete_output.description,
    inputSchema: { output_id: z.number().int().describe(T.delete_output.args.output_id) },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
      idempotentHint: true,
    },
  },
  async ({ output_id }) => {
    try {
      await client.write("DELETE", `/outputs/${output_id}`);
      return text(`Deleted output ${output_id} and all of its modulators.`);
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "set_tempo",
  {
    title: T.set_tempo.title,
    description: T.set_tempo.description,
    inputSchema: {
      clock: z
        .enum(["none", "tracker", "metronome", "ableton_link", "osc"])
        .optional()
        .describe(T.set_tempo.args.clock),
      metronome_bpm: z.number().min(20).max(300).optional().describe(T.set_tempo.args.metronome_bpm),
      beats_per_bar: z.number().int().min(2).max(8).optional().describe(T.set_tempo.args.beats_per_bar),
      tempo_bias: z
        .enum(["neutral", "prefer_slower", "prefer_faster"])
        .optional()
        .describe(T.set_tempo.args.tempo_bias),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true },
  },
  async (a) => {
    try {
      const CLOCK = { none: 1, tracker: 2, metronome: 3, ableton_link: 4, osc: 5 };
      const BIAS = { neutral: 1, prefer_slower: 2, prefer_faster: 3 };
      const body = {};
      if (a.clock) body.clockSource = CLOCK[a.clock];
      if (a.metronome_bpm !== undefined) body.metronomeTempo = a.metronome_bpm;
      if (a.beats_per_bar !== undefined) body.beatsPerBar = a.beats_per_bar;
      if (a.tempo_bias) body.tempoBias = BIAS[a.tempo_bias];
      if (Object.keys(body).length === 0) return text("Nothing to change - no fields were supplied.");
      await client.write("PUT", "/tempo", body);
      return text(`Tempo settings updated: ${Object.keys(body).join(", ")}.`);
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "list_audio_devices",
  {
    title: T.list_audio_devices.title,
    description: T.list_audio_devices.description,
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    try {
      const d = await client.get("/devices");
      const c = d.current || {};
      const lines = [
        `Currently open: ${c.inputDevice || "(none)"} via ${c.type || "?"} ` +
        `at ${c.sampleRate}Hz, buffer ${c.bufferSize}${c.open ? "" : " (NOT OPEN)"}`,
        ``,
        `Available inputs:`,
      ];
      for (const t of d.deviceTypes || []) {
        for (const name of t.inputDevices || []) {
          lines.push(`  ${name}${name === c.inputDevice ? "   <- current" : ""}  [${t.type}]`);
        }
      }
      return text(lines.join("\n"));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "select_audio_device",
  {
    title: T.select_audio_device.title,
    description: T.select_audio_device.description,
    inputSchema: {
      name: z.string().describe(T.select_audio_device.args.name),
      type: z.string().optional().describe(T.select_audio_device.args.type),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true },
  },
  async ({ name, type }) => {
    try {
      await client.write("PUT", "/devices", { name, type: type || "" });
      return text(
        `Switched input to "${name}". Check get_status to confirm the level has come up - ` +
        `if it has not, that device is open but silent.`
      );
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "tap_tempo",
  {
    title: T.tap_tempo.title,
    description: T.tap_tempo.description,
    inputSchema: {},
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async () => {
    try {
      await client.write("POST", "/tempo/tap");
      return text("Beat grid restarted. All 'fire every n beats' cycles now count from this moment.");
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "list_patches",
  {
    title: T.list_patches.title,
    description: T.list_patches.description,
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    try {
      const d = await client.get("/patches");
      const names = d.patches || [];
      return text(names.length ? `Saved patches:\n  ${names.join("\n  ")}` : "No saved patches yet.");
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "save_patch",
  {
    title: T.save_patch.title,
    description: T.save_patch.description,
    inputSchema: {
      name: z
        .string()
        .describe(T.save_patch.args.name),
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      idempotentHint: true,
      destructiveHint: true,
    },
  },
  async ({ name }) => {
    try {
      await client.write("POST", `/patches/${encodeURIComponent(name)}`);
      return text(`Saved the current configuration as "${name}".`);
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "load_patch",
  {
    title: T.load_patch.title,
    description: T.load_patch.description,
    inputSchema: { name: z.string().describe("Patch name from list_patches.") },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
      idempotentHint: true,
    },
  },
  async ({ name }) => {
    try {
      await client.write("POST", `/patches/${encodeURIComponent(name)}/load`);
      return text(`Loaded patch "${name}". The previous configuration has been replaced.`);
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "set_audioslice_token",
  {
    title: T.set_audioslice_token.title,
    description: T.set_audioslice_token.description,
    inputSchema: { token: z.string().describe("The token from AudioSlice > Advanced settings.") },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true },
  },
  async ({ token }) => {
    try {
      client.setToken(token);
      const p = tokenPath();
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify({ token }), { mode: 0o600 });
      await client.get("/health");
      return text("Token saved and verified - AudioSlice is reachable.");
    } catch (e) {
      return fail(new Error(`Token saved, but AudioSlice still is not reachable: ${e.message}`));
    }
  }
);

// --- prompts ----------------------------------------------------------------
// These appear as clickable starters in the client, which is what makes this
// approachable for someone who does not already know what to ask.

server.registerPrompt(
  "what_can_i_do",
  {
    title: PROMPTS.what_can_i_do.title,
    description: PROMPTS.what_can_i_do.description,
  },
  () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text:
          "Check AudioSlice's status, then analyse what is currently playing. Tell me which stems " +
          "have strong, usable signal and which are too quiet or too static to be worth using. " +
          "Then suggest two or three concrete things I could drive with them, saying which stem " +
          "and stream you would use for each and why. Consult the bundled documentation with " +
          "search_docs for what each stream is suited to, rather than assuming - it carries a " +
          "source-by-signal matrix and notes on which stems extract reliably.",
      },
    }],
  })
);

server.registerPrompt(
  "setup_beat_lighting",
  {
    title: PROMPTS.setup_beat_lighting.title,
    description: PROMPTS.setup_beat_lighting.description,
  },
  () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text:
          "Help me set up beat-synced triggers. First check the status and confirm the tempo looks " +
          "right. Ask me what I am sending to and on which address, then create the modulators. " +
          "If we end up with several firing on the same beat, stagger them a frame apart so their " +
          "packets do not all leave at once. Verify each one is actually firing when we are done. " +
          "If I want the triggers shaped over time rather than firing instantaneously, read the " +
          "envelope-creator documentation with read_doc before setting the envelope up.",
      },
    }],
  })
);

server.registerPrompt(
  "debug_no_output",
  {
    title: PROMPTS.debug_no_output.title,
    description: PROMPTS.debug_no_output.description,
  },
  () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text:
          "My OSC receiver is not showing anything. Work out where the problem is. Check whether " +
          "AudioSlice is running and hearing audio, whether it is actually transmitting and to " +
          "where, and whether each modulator is producing a signal and has an OSC path set. Then " +
          "tell me specifically which link in the chain is broken rather than listing everything " +
          "you checked. If it turns out to be something the receiving application has to be told " +
          "to do, check the documentation for that application with search_docs - Resolume, " +
          "TouchDesigner and Synesthesia each need OSC input enabled in their own way.",
      },
    }],
  })
);

server.registerPrompt(
  "review_setup",
  {
    title: PROMPTS.review_setup.title,
    description: PROMPTS.review_setup.description,
  },
  () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text:
          "Review my current AudioSlice configuration. List what is set up, then flag anything " +
          "wrong or wasteful: modulators with no OSC path, ones that are not producing any signal, " +
          "stems that are silent, streams selected that the stem does not carry, or several " +
          "modulators fighting over the same OSC address. Be specific about what to change.",
      },
    }],
  })
);

// Worth its own starter now that the integration guides ship with the server:
// getting OSC into Resolume or TouchDesigner is where people get stuck, and it is
// the one part of the chain AudioSlice cannot inspect for them.
server.registerPrompt(
  "connect_visuals_app",
  {
    title: PROMPTS.connect_visuals_app.title,
    description: PROMPTS.connect_visuals_app.description,
  },
  () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text:
          "Help me get AudioSlice driving my visuals application. Ask me which one I am using, " +
          "then read its setup guide with read_doc and follow it - the receiving side usually has " +
          "to be told to listen for OSC before anything arrives, and each application does that " +
          "differently. Create the output and a modulator or two to prove the link works, then " +
          "verify they are actually firing. Tell me what I need to do on the receiving end, since " +
          "you cannot do that part for me.",
      },
    }],
  })
);

// --- go ---------------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);

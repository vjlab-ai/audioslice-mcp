#!/usr/bin/env node
// AudioSlice MCP server.
//
// Talks to a locally running AudioSlice over its localhost HTTP control API.
// Makes no outbound network calls of any kind: documentation is baked in at
// build time, so this behaves identically with or without an internet
// connection - which matters at a venue.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";

import { AudioSliceClient } from "./client.js";
import { stemIndex, streamId, stemName, msToAlpha, STEMS, STREAMS } from "./stems.js";
import { formatStatus, formatSignals, formatActivity, formatOutputs } from "./format.js";

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
    title: "AudioSlice status",
    description:
      "Check whether AudioSlice is running, hearing audio, tracking tempo, keeping up with " +
      "inference, and successfully transmitting OSC. Call this FIRST for any question about " +
      "something not working - it distinguishes the four failure modes that look identical from " +
      "the outside: not running, not hearing audio, not sending, or sending fine but the receiver " +
      "is not listening. Also call it before configuring anything, so you know the tempo and " +
      "whether there is signal to work with.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
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
    title: "Analyze what is in the audio",
    description:
      "Summarise what the model is actually extracting from the audio right now, per stem, over a " +
      "recent window: how loud each stem is, how much it moves, how many times it hits, and which " +
      "data streams it carries. Call this before creating modulators, to choose a stem that has " +
      "usable signal, and whenever the user asks what they could drive with a track. " +
      "This reads the RAW model output - it is not affected by any modulator's settings, so it " +
      "tells you about the music rather than about someone's existing configuration. Use " +
      "describe_modulator instead to check whether a configured modulator is working.",
    inputSchema: {
      window_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("How far back to summarise, in milliseconds. Defaults to the full ~5900ms retained."),
    },
    annotations: { readOnlyHint: true },
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
    title: "List OSC outputs and modulators",
    description:
      "List every configured OSC destination and the modulators on it, with each modulator's OSC " +
      "path, source stem and shaping settings. Call this to see the current configuration before " +
      "changing anything, and to find the output and modulator ids that the other tools need. " +
      "Modulators with no OSC path are flagged - they process audio but transmit nothing, and " +
      "AudioSlice reports no error for that.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
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
    title: "Check whether a modulator is working",
    description:
      "Report what one modulator is actually emitting over a recent window: how many times it " +
      "fired, its peak and average, and its instantaneous value. Call this to verify a modulator " +
      "after creating or changing it, or when the user says a specific thing is not working. " +
      "For beat and onset sources, judge by how many times it fired, NOT by the instantaneous " +
      "value - those signals are non-zero for roughly one frame in 86, so an instantaneous read " +
      "is almost always zero even when the modulator is working perfectly.",
    inputSchema: {
      output_id: z.number().int().describe("Output id, from list_outputs."),
      modulator_id: z.number().int().describe("Modulator id, from list_outputs."),
      window_ms: z.number().int().positive().optional().describe("Window in ms; defaults to ~5900."),
    },
    annotations: { readOnlyHint: true },
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

server.registerTool(
  "get_api_schema",
  {
    title: "AudioSlice field reference",
    description:
      "Fetch AudioSlice's own field-by-field reference for outputs, modulators, settings and " +
      "tempo, straight from the running app. Call this when you need the exact meaning, units or " +
      "valid range of a field before setting it, or when a setting did not behave as expected. " +
      "It is authoritative for the installed version, so prefer it over assumptions.",
    inputSchema: {
      section: z
        .enum(["modulator", "output", "settings", "tempo", "signalSummary", "statistics", "all"])
        .optional()
        .describe("Which field group to return. Defaults to modulator, the one most often needed."),
    },
    annotations: { readOnlyHint: true },
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
    title: "Create an OSC destination",
    description:
      "Create a new OSC destination (an IP and port to send to). Do this before creating " +
      "modulators, since every modulator belongs to an output. Returns the new output's id. " +
      "Note that changing configuration briefly interrupts OSC transmission, so avoid " +
      "reconfiguring during a live performance.",
    inputSchema: {
      name: z.string().describe("Display name, e.g. \"Resolume\" or \"stage left rig\"."),
      ip: z.string().default("127.0.0.1").describe("Destination IP address."),
      port: z.number().int().min(1).max(65535).describe("Destination UDP port."),
      send_interval_ms: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("How often to transmit, in ms. Defaults to 11 (one engine frame, ~86/sec)."),
    },
    annotations: { readOnlyHint: false },
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
    title: "Create a modulator",
    description:
      "Add a modulator to an output: it takes one data stream from one stem and sends it to an OSC " +
      "address. The osc_path is what determines where data goes - a modulator without one processes " +
      "audio and transmits nothing, silently. Check analyze_audio first to pick a stem that has " +
      "signal and carries the stream you want; asking for a stream a stem does not have produces " +
      "silence with no error. Verify the result with describe_modulator afterwards.",
    inputSchema: {
      output_id: z.number().int().describe("Which output to add it to, from list_outputs."),
      osc_path: z.string().describe("OSC address to send to, e.g. \"/composition/layers/1/video/opacity\"."),
      stem: z.string().describe(`Source stem. One of: ${STEMS.join(", ")}.`),
      stream: z
        .string()
        .optional()
        .describe(`Which data stream: ${Object.keys(STREAMS).join(", ")}. Defaults to energy.`),
      name: z.string().optional().describe("Display label only - has no effect on output."),
      range_min: z.number().optional().describe("Value sent when the stem level is 0. Default 0."),
      range_max: z.number().optional().describe("Value sent when the stem level is 1. Default 1."),
      smoothing_ms: z
        .number()
        .optional()
        .describe("Smoothing time in ms. 0 or omitted means none. Higher is smoother but laggier."),
      fire_every_beats: z
        .number()
        .int()
        .min(1)
        .max(256)
        .optional()
        .describe("For beat sources: fire only every nth beat. 4 = once a bar in 4/4."),
      beat_offset_frames: z
        .number()
        .int()
        .min(0)
        .max(64)
        .optional()
        .describe(
          "Delay this modulator's beat event by n frames (~11.6ms each) without changing which " +
          "beats it fires on. Use it to stagger several modulators that share the same " +
          "fire_every_beats so their packets leave separately rather than all at once."
        ),
      switch_mode: z
        .boolean()
        .optional()
        .describe("Send a single integer 1 per event instead of a continuous level. For Resolume-style triggers."),
    },
    annotations: { readOnlyHint: false },
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
    title: "Change a modulator",
    description:
      "Change settings on an existing modulator. Only the fields you pass are altered. Prefer one " +
      "call that changes several fields over several calls changing one each - every change briefly " +
      "interrupts OSC transmission, so a rapid series of edits is disruptive during a performance. " +
      "Re-check with describe_modulator afterwards rather than assuming the change took effect, " +
      "since the user may be editing the same modulator in the UI.",
    inputSchema: {
      output_id: z.number().int(),
      modulator_id: z.number().int(),
      osc_path: z.string().optional().describe("New OSC address."),
      enabled: z.boolean().optional(),
      stem: z.string().optional().describe(`New source stem: ${STEMS.join(", ")}.`),
      stream: z.string().optional().describe(`New stream: ${Object.keys(STREAMS).join(", ")}.`),
      range_min: z.number().optional(),
      range_max: z.number().optional(),
      smoothing_ms: z.number().optional(),
      fire_every_beats: z.number().int().min(1).max(256).optional(),
      beat_offset_frames: z.number().int().min(0).max(64).optional(),
      switch_mode: z.boolean().optional(),
      invert: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false },
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
    title: "Delete a modulator",
    description:
      "Permanently remove a modulator from an output. This cannot be undone and the modulator stops " +
      "transmitting immediately. Confirm with the user before calling it, and prefer setting " +
      "enabled=false via update_modulator if they may want it back.",
    inputSchema: { output_id: z.number().int(), modulator_id: z.number().int() },
    annotations: { readOnlyHint: false, destructiveHint: true },
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
    title: "Delete an OSC output",
    description:
      "Permanently remove an OSC destination AND every modulator on it. This cannot be undone. " +
      "Always confirm with the user first, and list_outputs beforehand so they know exactly what " +
      "will be lost.",
    inputSchema: { output_id: z.number().int() },
    annotations: { readOnlyHint: false, destructiveHint: true },
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
    title: "Set the tempo source",
    description:
      "Change how AudioSlice determines tempo: track the incoming audio, run a fixed metronome, or " +
      "sync to Ableton Link. Use the real-time tracker for live audio, and the metronome when there " +
      "is no reliable beat to track. If tracker confidence from get_status is low, tempo_bias can " +
      "steer it away from half-time or double-time readings.",
    inputSchema: {
      clock: z.enum(["none", "tracker", "metronome", "ableton_link", "osc"]).optional(),
      metronome_bpm: z.number().min(20).max(300).optional().describe("Fixed BPM, when clock=metronome."),
      beats_per_bar: z.number().int().min(2).max(8).optional(),
      tempo_bias: z
        .enum(["neutral", "prefer_slower", "prefer_faster"])
        .optional()
        .describe("Nudge the tracker when it locks to half or double the intended tempo."),
    },
    annotations: { readOnlyHint: false },
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
    title: "List audio input devices",
    description:
      "List the audio input devices available on this machine and which one AudioSlice currently " +
      "has open, with its sample rate and buffer size. Call this when AudioSlice reports it is not " +
      "hearing audio, so you can offer the user the actual device names to try. Pair it with " +
      "get_status: switch a device, then check whether the input level comes up.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
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
    title: "Switch the audio input device",
    description:
      "Switch AudioSlice to a different audio input. Use the exact name from list_audio_devices. " +
      "This briefly interrupts audio and OSC output while the device is reopened, so do not do it " +
      "during a performance without asking. After switching, call get_status to confirm the input " +
      "level actually came up - opening a device successfully does not mean sound is arriving on it.",
    inputSchema: {
      name: z.string().describe("Exact device name from list_audio_devices."),
      type: z.string().optional().describe("Driver type, e.g. CoreAudio. Usually unnecessary."),
    },
    annotations: { readOnlyHint: false },
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
    title: "Restart the beat grid",
    description:
      "Restart the beat cycle at this instant, exactly like the app's \"Tap for 1\" button. Every " +
      "modulator set to fire every n beats re-anchors here, so a group that has drifted out of " +
      "phase with the music lines up again. Use it when beat-driven output is landing on the wrong " +
      "beat rather than not firing at all - if it is not firing, describe_modulator will show that.",
    inputSchema: {},
    annotations: { readOnlyHint: false },
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
    title: "List saved patches",
    description:
      "List the saved AudioSlice configurations by name. Call this before load_patch so you can " +
      "offer real names, and before save_patch so you do not silently overwrite one.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
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
    title: "Save the current configuration",
    description:
      "Save the entire current configuration - every output and modulator - under a name, so it can " +
      "be restored later. Worth doing before any substantial reconfiguration, so there is a way " +
      "back. Saving over an existing name replaces it, so check list_patches first.",
    inputSchema: {
      name: z
        .string()
        .describe("A name using letters, numbers, spaces, hyphens and underscores only (max 64)."),
    },
    annotations: { readOnlyHint: false },
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
    title: "Load a saved configuration",
    description:
      "DESTRUCTIVE: replace the ENTIRE current configuration with a saved patch. Every existing " +
      "output and modulator is torn down and rebuilt, and anything not saved is lost. Always " +
      "confirm with the user first, and offer to save_patch the current state before proceeding. " +
      "Never call this during a live performance without explicit agreement - it interrupts all " +
      "output while the rebuild happens.",
    inputSchema: { name: z.string().describe("Patch name from list_patches.") },
    annotations: { readOnlyHint: false, destructiveHint: true },
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
    title: "Save the AudioSlice API token",
    description:
      "Store the API token so this extension can talk to AudioSlice. Only needed if AudioSlice has " +
      "a token configured - by default it does not, and everything works with no setup. Call this " +
      "when a tool reports a 401, after asking the user to copy the token from AudioSlice's " +
      "Advanced settings. It is saved locally and reused in future conversations.",
    inputSchema: { token: z.string().describe("The token from AudioSlice > Advanced settings.") },
    annotations: { readOnlyHint: false },
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
    title: "What can I do with this track?",
    description: "Analyse what is playing and suggest what to drive with it.",
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
          "and stream you would use for each and why.",
      },
    }],
  })
);

server.registerPrompt(
  "setup_beat_lighting",
  {
    title: "Set up beat-synced lighting",
    description: "Create beat-driven OSC triggers, staggered so they do not collide.",
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
          "packets do not all leave at once. Verify each one is actually firing when we are done.",
      },
    }],
  })
);

server.registerPrompt(
  "debug_no_output",
  {
    title: "Why isn't my OSC arriving?",
    description: "Work through why a receiver is showing nothing.",
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
          "you checked.",
      },
    }],
  })
);

server.registerPrompt(
  "review_setup",
  {
    title: "Review my current setup",
    description: "Audit the existing configuration for problems.",
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

// --- go ---------------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);

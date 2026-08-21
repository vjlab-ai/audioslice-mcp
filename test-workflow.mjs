// Full-chain functional test: drives the MCP server exactly as a client would,
// builds a real modulator from what it finds in the audio, and verifies OSC
// packets actually arrive at a listening socket. Cleans up after itself.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import dgram from "node:dgram";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9987;

// --- minimal OSC reader: enough to pull addresses and float args out of a bundle
function readOsc(buf) {
  const out = [];
  const readStr = (o) => {
    let e = o; while (e < buf.length && buf[e] !== 0) e++;
    return [buf.toString("ascii", o, e), o + (Math.floor((e - o) / 4) + 1) * 4];
  };
  const readMsg = (o, end) => {
    let addr, tags;
    [addr, o] = readStr(o);
    if (o >= end) return;
    [tags, o] = readStr(o);
    const args = [];
    for (const t of tags.slice(1)) {
      if (t === "f") { args.push(+buf.readFloatBE(o).toFixed(3)); o += 4; }
      else if (t === "i") { args.push(buf.readInt32BE(o)); o += 4; }
    }
    out.push({ addr, args });
  };
  if (buf.toString("ascii", 0, 7) === "#bundle") {
    let o = 16;
    while (o + 4 <= buf.length) {
      const size = buf.readInt32BE(o); o += 4;
      if (size <= 0 || o + size > buf.length) break;
      readMsg(o, o + size); o += size;
    }
  } else readMsg(0, buf.length);
  return out;
}

const sock = dgram.createSocket("udp4");
const received = [];
sock.on("message", (m) => { for (const x of readOsc(m)) received.push(x); });
await new Promise((r) => sock.bind(PORT, "127.0.0.1", r));
console.log(`OSC listener up on 127.0.0.1:${PORT}\n`);

const transport = new StdioClientTransport({
  command: process.execPath, args: [join(HERE, "server", "index.js")],
});
const client = new Client({ name: "workflow", version: "0" });
await client.connect(transport);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const body = r.content.map((c) => c.text).join("\n");
  if (r.isError) throw new Error(`${name} failed: ${body}`);
  return body;
};

let outputId = null;
try {
  console.log("1. analyze_audio — what is actually in the track?");
  const analysis = await call("analyze_audio", { window_ms: 3000 });
  console.log(analysis.split("\n").slice(3, 11).join("\n"));

  // Choose a percussive stem that is actually firing, from the analysis itself.
  const hits = [...analysis.matchAll(/^\s{2}(\w[\w ()]*?)\s{2,}peak [\d.]+, avg [\d.]+, (\d+) hits/gm)]
    .map((m) => ({ stem: m[1].trim(), hits: +m[2] }))
    .filter((x) => ["kick", "snare", "hihat", "perc"].includes(x.stem) && x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (!hits.length) throw new Error("no percussive stem is firing - is music playing?");
  const chosen = hits[0];
  console.log(`\n   -> picking "${chosen.stem}" (${chosen.hits} hits in 3s)\n`);

  console.log("2. create_osc_output");
  const made = await call("create_osc_output", {
    name: "mcp workflow test", ip: "127.0.0.1", port: PORT,
  });
  console.log("   " + made);
  outputId = +made.match(/id (\d+)/)[1];

  console.log("3. create_modulator on that stem (onset -> switch mode)");
  const mod = await call("create_modulator", {
    output_id: outputId, osc_path: "/mcp/test/hit",
    stem: chosen.stem, stream: "onset", switch_mode: true, name: "workflow probe",
  });
  console.log("   " + mod);
  const modId = +mod.match(/modulator (\d+)/)[1];

  console.log("\n4. listening for real OSC for 5s...");
  received.length = 0;
  await new Promise((r) => setTimeout(r, 5000));
  const mine = received.filter((m) => m.addr === "/mcp/test/hit");
  console.log(`   packets on /mcp/test/hit: ${mine.length}`);
  console.log(`   sample payloads: ${JSON.stringify(mine.slice(0, 6).map((m) => m.args))}`);

  console.log("\n5. describe_modulator — does the MCP agree?");
  console.log(await call("describe_modulator", { output_id: outputId, modulator_id: modId, window_ms: 5000 }));

  console.log("\n=== VERDICT ===");
  console.log(mine.length > 0
    ? `PASS - ${mine.length} OSC messages actually arrived, driven end to end by the MCP.`
    : `FAIL - the modulator reports activity but no OSC reached the socket.`);
} finally {
  if (outputId !== null) {
    console.log(`\n6. cleanup: delete_output ${outputId}`);
    console.log("   " + await call("delete_output", { output_id: outputId }));
  }
  await client.close();
  sock.close();
}

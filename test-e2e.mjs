// End-to-end smoke test: drives the MCP server over stdio the same way a
// desktop client does, against a running AudioSlice.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(HERE, "server", "index.js")],
});
const client = new Client({ name: "e2e", version: "0" });
await client.connect(transport);

const tools = await client.listTools();
console.log(`TOOLS (${tools.tools.length}):`, tools.tools.map((t) => t.name).join(", "));
const prompts = await client.listPrompts();
console.log(`PROMPTS (${prompts.prompts.length}):`, prompts.prompts.map((p) => p.name).join(", "));

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const body = r.content.map((c) => c.text).join("\n");
  console.log(`\n===== ${name} ${JSON.stringify(args)} =====`);
  console.log(body.split("\n").slice(0, 18).join("\n"));
  return { r, body };
}

await call("get_status");
await call("analyze_audio", { window_ms: 2000 });
await call("list_outputs");
await call("describe_modulator", { output_id: 9, modulator_id: 10, window_ms: 2000 });

await call("list_audio_devices");
await call("list_patches");
await call("tap_tempo");

// error paths
const bad = await call("describe_modulator", { output_id: 9, modulator_id: 99999 });
console.log("  -> isError:", bad.r.isError === true);
const bad2 = await call("select_audio_device", { name: "No Such Device" });
console.log("  -> bad device isError:", bad2.r.isError === true);

await client.close();
console.log("\nE2E OK");

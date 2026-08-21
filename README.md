# AudioSlice MCP server

Connects Claude to a running AudioSlice, so you can ask what a track can drive,
build OSC modulators for it, and work out why a receiver is showing nothing.

## What it can do

| Tool | Purpose |
|---|---|
| `get_status` | Running? Hearing audio? Tracking tempo? Transmitting OSC? |
| `analyze_audio` | What's in the audio per stem, and which streams each carries |
| `list_outputs` | Every OSC destination and its modulators |
| `describe_modulator` | Whether one modulator is actually firing |
| `get_api_schema` | AudioSlice's own field reference, from the running app |
| `create_osc_output` / `create_modulator` | Build a configuration |
| `update_modulator` | Change one |
| `delete_modulator` / `delete_output` | Remove one (destructive) |
| `set_tempo` | Clock source, metronome BPM, tempo bias |
| `set_audioslice_token` | Store an API token, if one is set |

Four prompts ship as conversation starters: *what can I do with this track*,
*set up beat-synced lighting*, *why isn't my OSC arriving*, *review my setup*.

## Design notes

**It only talks to localhost.** The sole connection is to AudioSlice's control
API on 127.0.0.1. There are no outbound network calls of any kind — the
documentation it uses is baked in at build time — so it behaves identically at a
venue with no wifi. That is also a straightforward thing to tell a venue's IT
department.

**Reads are free, writes are paced.** Every mutating call briefly parks
AudioSlice's output thread while it applies, so a burst of edits would interrupt
OSC repeatedly — potentially mid-show. `client.js` serialises mutations and
spaces them at least 120 ms apart. Reads are never queued and cannot affect
audio at all.

**It reasons about windows, not instants.** One engine frame is ~11.6 ms, so a
beat or onset signal is non-zero for roughly one frame in 86. A snapshot of a
perfectly healthy beat modulator reads zero almost every time. Every tool that
reports signal reports it over a window and leads with how many times something
*fired*, not what it reads right now.

**No native modules, deliberately.** The bundle is sealed into the signed app,
and Apple's notary service inspects nested archives — an unsigned binary in here
would fail notarization for the whole DMG. `cmake/CheckMcpBundleNative.cmake`
fails the build if one ever appears via a transitive dependency.

## Development

```bash
cd mcp
npm install
node test-e2e.mjs        # drives the server over stdio against a running AudioSlice
```

`test-e2e.mjs` exercises the tools the way a desktop client does and checks the
error paths. AudioSlice must be running with its HTTP API enabled (it is by
default).

## Building the bundle

```bash
cmake .. -DAUDIOSLICE_BUILD_MCP=ON
cmake --build . --target audioslice_mcp
```

Produces `mcp/audioslice-mcp.mcpb` and copies it into the app bundle, where the
"Install Claude Desktop integration" button hands it to Claude Desktop. The
target validates the manifest and rejects native modules before packing.

To install by hand for testing, double-click the `.mcpb`.

## Connection

The port is discovered automatically: AudioSlice writes `mcp.json` next to its
settings whenever the API starts, so changing the port in Advanced settings needs
no reconfiguration here. `AUDIOSLICE_PORT` overrides it if needed.

AudioSlice ships without an API token, so there is normally nothing to configure.
If one is set, tools return a message asking for it; pass it to
`set_audioslice_token` and it is stored locally for future conversations.

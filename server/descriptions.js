// Every word this server says to a model, in one place.
//
// Tool and prompt wording is the whole interface: a model picks a tool, and
// decides what to pass it, from these strings and nothing else. They are kept out
// of index.js so they can be read and revised as prose, without picking through
// registration code to find them.
//
// Much of the guidance here is drawn from the user documentation vendored in
// docs/ - the same text search_docs serves. Where a description says "the docs
// recommend", that is a real recommendation from those pages, not a guess. If you
// change what the docs say, revisit the matching description here.

export const TOOLS = {
  get_status: {
    title: "AudioSlice status",
    description:
      "Check whether AudioSlice is running, hearing audio, tracking tempo, keeping up with " +
      "inference, and successfully transmitting OSC. Call this FIRST for any question about " +
      "something not working - it distinguishes the four failure modes that look identical from " +
      "the outside: not running, not hearing audio, not sending, or sending fine but the " +
      "receiver is not listening. Also call it before configuring anything, so you know the " +
      "tempo and whether there is signal to work with. " +
      "\n\n" +
      "Docs note: AudioSlice needs clean audio from an application or an interface - microphone " +
      "input is explicitly not supported yet, so \"hearing nothing\" on a mic is expected rather " +
      "than broken. On macOS routing system audio needs a virtual device (BlackHole or " +
      "Loopback) plus a Multi-Output Device so the user can still hear it; on Windows nothing " +
      "extra is needed, as AudioSlice detects the output device by loopback itself. read_doc " +
      "audio-input for the full walkthrough before talking anyone through cables.",
  },
  analyze_audio: {
    title: "Analyze what is in the audio",
    description:
      "Summarise what the model is actually extracting from the audio right now, per stem, over " +
      "a recent window: how loud each stem is, how much it moves, how many times it hits, and " +
      "which data streams it carries. Call this before creating modulators, to choose a stem " +
      "that has usable signal, and whenever the user asks what they could drive with a track. " +
      "This reads the RAW model output - it is not affected by any modulator's settings, so it " +
      "tells you about the music rather than about someone's existing configuration. Use " +
      "describe_modulator instead to check whether a configured modulator is working. " +
      "\n\n" +
      "This reports what each stem is doing in the current track. What a stem can carry at all, " +
      "and how reliably, is in the documentation - search_docs for \"signals\" to get the " +
      "source-by-signal matrix, which also rates extraction accuracy per stem (tom, percussion " +
      "and 'other' are moderate rather than high).",
    args: {
      window_ms:
        "How far back to summarise, in milliseconds. Defaults to the full ~5900ms retained.",
    },
  },
  list_outputs: {
    title: "List OSC outputs and modulators",
    description:
      "List every configured OSC destination and the modulators on it, with each modulator's " +
      "OSC path, source stem and shaping settings. Call this to see the current configuration " +
      "before changing anything, and to find the output and modulator ids that the other tools " +
      "need. Modulators with no OSC path are flagged - they process audio but transmit nothing, " +
      "and AudioSlice reports no error for that.",
  },
  describe_modulator: {
    title: "Check whether a modulator is working",
    description:
      "Report what one modulator is actually emitting over a recent window: how many times it " +
      "fired, its peak and average, and its instantaneous value. Call this to verify a " +
      "modulator after creating or changing it, or when the user says a specific thing is not " +
      "working. For beat and onset sources, judge by how many times it fired, NOT by the " +
      "instantaneous value - those signals are non-zero for roughly one frame in 86, so an " +
      "instantaneous read is almost always zero even when the modulator is working perfectly.",
    args: {
      output_id:
        "Output id, from list_outputs.",
      modulator_id:
        "Modulator id, from list_outputs.",
      window_ms:
        "Window in ms; defaults to ~5900.",
    },
  },
  search_docs: {
    title: "Search AudioSlice documentation",
    description:
      "Search the AudioSlice user documentation - how the engine works, what each control does, " +
      "and how to set it up with Resolume, TouchDesigner or Synesthesia. Call this before " +
      "answering any 'how do I' or 'what does X do' question, rather than answering from " +
      "memory: these docs ship with the installed version and are specific to it. For what is " +
      "currently configured, use the other tools instead - the docs describe behaviour, not " +
      "live state. Pages: {{DOC_PAGES}}.",
    args: {
      query:
        "What to look for, e.g. \"onset threshold\" or \"resolume setup\".",
      max_results:
        "How many passages to return. Defaults to 5.",
    },
  },
  read_doc: {
    title: "Read an AudioSlice documentation page",
    description:
      "Read one documentation page in full. Use it after search_docs when a passage looks right " +
      "but you need the surrounding steps - setup guides in particular lose their meaning when " +
      "quoted a section at a time. Pages: {{DOC_PAGES}}.",
    args: {
      page:
        "Page slug. One of: {{DOC_PAGES}}.",
    },
  },
  get_api_schema: {
    title: "AudioSlice field reference",
    description:
      "Fetch AudioSlice's own field-by-field reference for outputs, modulators, settings and " +
      "tempo, straight from the running app. Call this when you need the exact meaning, units " +
      "or valid range of a field before setting it, or when a setting did not behave as " +
      "expected. It is authoritative for the installed version, so prefer it over assumptions. " +
      "\n\n" +
      "This covers what a field means. For how a feature behaves, or how to set something up, " +
      "search_docs the bundled user documentation instead.",
    args: {
      section:
        "Which field group to return. Defaults to modulator, the one most often needed.",
    },
  },
  create_osc_output: {
    title: "Create an OSC destination",
    description:
      "Create a new OSC destination (an IP and port to send to). Do this before creating " +
      "modulators, since every modulator belongs to an output. Returns the new output's id. " +
      "Note that changing configuration briefly interrupts OSC transmission, so avoid " +
      "reconfiguring during a live performance. " +
      "\n\n" +
      "Docs note: an output group is a host:port plus a send rate, and holds modulators that " +
      "all send there. Groups are independent, so a TouchDesigner group can send at a different " +
      "rate than a Resolume one. 11ms is the fastest rate and the default; raise it if the " +
      "receiving application cannot keep up with that. The beat and tempo paths on the group " +
      "are a fallback - the docs recommend beat ramps or onset modulators instead unless a " +
      "numeric BPM is specifically wanted. read_doc output-groups for the detail.",
    args: {
      name:
        "Display name, e.g. \"Resolume\" or \"stage left rig\".",
      ip:
        "Destination IP address.",
      port:
        "Destination UDP port.",
      send_interval_ms:
        "How often to transmit, in ms. Defaults to 11 (one engine frame, ~86/sec).",
    },
  },
  create_modulator: {
    title: "Create a modulator",
    description:
      "Add a modulator to an output: it takes one data stream from one stem and sends it to an " +
      "OSC address. The osc_path is what determines where data goes - a modulator without one " +
      "processes audio and transmits nothing, silently. Check analyze_audio first to pick a " +
      "stem that has signal and carries the stream you want; asking for a stream a stem does " +
      "not have produces silence with no error. Verify the result with describe_modulator " +
      "afterwards. " +
      "\n\n" +
      "The documentation carries a source-by-signal matrix and per-stream guidance - " +
      "search_docs for \"modulators\" before guessing which stem and stream suit what the user is " +
      "building. Two things from it that are easy to get wrong: onsets exist only for the " +
      "individual drums (kick, snare, hi-hat, tom, percussion), the whole mix, and " +
      "beat/downbeat - not for the combined drums stem, and not for vocals or bass, which carry " +
      "pitch instead. And for pitch modulators the docs suggest a threshold around 0.1-0.2 with " +
      "20-50ms of smoothing, with silence mapping to the range minimum rather than to zero.",
    args: {
      threshold:
        "Level below which the modulator sends 0. On the onset stream this is the onset " +
        "sensitivity: onset values carry how loud the hit was, so a higher threshold keeps only " +
        "the harder hits. Omit it on an onset modulator to get that stem's tuned default - kick " +
        "and snare 0.15, hihat and percussion 0.20, tom 0.10. search_docs \"onset threshold\" for " +
        "when adjusting it is worthwhile: the documented case is two hihat modulators, a high " +
        "threshold for the main offbeat hats and a low one for the sixteenths underneath.",
      output_id:
        "Which output to add it to, from list_outputs.",
      osc_path:
        "OSC address to send to, e.g. \"/composition/layers/1/video/opacity\".",
      stem:
        "Source stem. One of: {{STEMS}}.",
      stream:
        "Which data stream: {{STREAMS}}. Defaults to energy.",
      name:
        "Display label only - has no effect on output.",
      range_min:
        "Value sent when the stem level is 0. Default 0.",
      range_max:
        "Value sent when the stem level is 1. Default 1.",
      smoothing_ms:
        "Smoothing time in ms. 0 or omitted means none. Higher is smoother but laggier.",
      fire_every_beats:
        "For beat sources: fire only every nth beat. 4 = once a bar in 4/4.",
      beat_offset_frames:
        "Delay this modulator's beat event by n frames (~11.6ms each) without changing which " +
        "beats it fires on. Use it to stagger several modulators that share the same " +
        "fire_every_beats so their packets leave separately rather than all at once.",
      switch_mode:
        "Send a single integer 1 per event instead of a continuous level. For Resolume-style " +
        "triggers.",
    },
  },
  update_modulator: {
    title: "Change a modulator",
    description:
      "Change settings on an existing modulator. Only the fields you pass are altered. Prefer " +
      "one call that changes several fields over several calls changing one each - every change " +
      "briefly interrupts OSC transmission, so a rapid series of edits is disruptive during a " +
      "performance. Re-check with describe_modulator afterwards rather than assuming the change " +
      "took effect, since the user may be editing the same modulator in the UI. " +
      "\n\n" +
      "Docs note: search_docs before changing stream or stem - the documentation carries a " +
      "source-by-signal matrix saying which stems carry which streams and how reliably each " +
      "extracts.",
    args: {
      threshold:
        "Level below which the modulator sends 0. On the onset stream this is the onset " +
        "sensitivity - raise it to keep only the harder hits, lower it to let quieter ones " +
        "through. Changing stem, or switching to the onset stream, re-seeds this with that stem's " +
        "tuned default unless you set it in the same call.",
      output_id:
        "Which output the modulator belongs to, from list_outputs.",
      modulator_id:
        "Which modulator to change, from list_outputs.",
      enabled:
        "Whether this modulator transmits at all. Disabling keeps its configuration, so it is the " +
        "reversible way to silence one - prefer it to deleting.",
      range_min:
        "Value sent when the stem level is 0.",
      range_max:
        "Value sent when the stem level is 1.",
      smoothing_ms:
        "Smoothing time in ms. 0 means none. Higher is smoother but laggier, and on an onset or " +
        "beat stream it smears the impulse away rather than shaping it.",
      fire_every_beats:
        "For beat sources: fire only every nth beat. 4 = once a bar in 4/4.",
      beat_offset_frames:
        "Delay this modulator's beat event by n frames (~11.6ms each) without changing which " +
        "beats it fires on. Use it to stagger modulators that share a fire_every_beats so their " +
        "packets leave separately.",
      switch_mode:
        "Send a single integer 1 per event instead of a continuous level. For Resolume-style " +
        "triggers.",
      invert:
        "Send 1 minus the value. On is_music this turns 'music started' into 'music stopped'; on " +
        "a beat ramp it makes the ramp fall rather than rise.",
      osc_path:
        "New OSC address.",
      stem:
        "New source stem: {{STEMS}}.",
      stream:
        "New stream: {{STREAMS}}.",
    },
  },
  delete_modulator: {
    title: "Delete a modulator",
    description:
      "Permanently remove a modulator from an output. This cannot be undone and the modulator " +
      "stops transmitting immediately. Confirm with the user before calling it, and prefer " +
      "setting enabled=false via update_modulator if they may want it back.",
    args: {
      output_id:
        "Which output the modulator belongs to, from list_outputs.",
      modulator_id:
        "Which modulator to delete, from list_outputs.",
    },
  },
  delete_output: {
    title: "Delete an OSC output",
    description:
      "Permanently remove an OSC destination AND every modulator on it. This cannot be undone. " +
      "Always confirm with the user first, and list_outputs beforehand so they know exactly " +
      "what will be lost.",
    args: {
      output_id:
        "Which output to delete, from list_outputs. Its modulators go with it.",
    },
  },
  set_tempo: {
    title: "Set the tempo source",
    description:
      "Change how AudioSlice determines tempo: track the incoming audio, run a fixed metronome, " +
      "or sync to Ableton Link. Use the real-time tracker for live audio, and the metronome " +
      "when there is no reliable beat to track. If tracker confidence from get_status is low, " +
      "tempo_bias can steer it away from half-time or double-time readings. " +
      "\n\n" +
      "Docs note: the docs recommend leaving these alone. AudioSlice tracks tempo from the " +
      "audio with no tapping, click track or timecode, and follows changes live. Give it a bar " +
      "or two to settle on a new track - sparse intros and ambient passages have less to lock " +
      "onto than a four-on-the-floor groove, so a wrong reading during an intro is not " +
      "necessarily a fault. Set tempo_bias only when the material genuinely skews slow or fast " +
      "(hip hop versus drum & bass). Ableton Link works in both directions and negotiates " +
      "automatically, so AudioSlice can drive Live or follow it. read_doc tempo for the detail.",
    args: {
      clock:
        "Where tempo comes from. \"tracker\" follows the audio and is the default; \"metronome\" runs " +
        "a fixed BPM; \"ableton_link\" negotiates with other Link apps on the network; \"osc\" " +
        "follows incoming OSC beats; \"none\" stops tempo entirely.",
      beats_per_bar:
        "Beats per measure, for deciding which beat is beat 1. 4 for common time.",
      metronome_bpm:
        "Fixed BPM, when clock=metronome.",
      tempo_bias:
        "Nudge the tracker when it locks to half or double the intended tempo.",
    },
  },
  list_audio_devices: {
    title: "List audio input devices",
    description:
      "List the audio input devices available on this machine and which one AudioSlice " +
      "currently has open, with its sample rate and buffer size. Call this when AudioSlice " +
      "reports it is not hearing audio, so you can offer the user the actual device names to " +
      "try. Pair it with get_status: switch a device, then check whether the input level comes " +
      "up. " +
      "\n\n" +
      "Docs note: on macOS the device wanted here is usually a virtual one (BlackHole or " +
      "Loopback) fed by a Multi-Output Device, not a physical input. On Windows AudioSlice " +
      "detects the outputting device by loopback on its own, and the docs are emphatic that " +
      "VB-Audio Cable and Voicemeeter are not needed. read_doc audio-input before recommending " +
      "any extra software.",
  },
  select_audio_device: {
    title: "Switch the audio input device",
    description:
      "Switch AudioSlice to a different audio input. Use the exact name from " +
      "list_audio_devices. This briefly interrupts audio and OSC output while the device is " +
      "reopened, so do not do it during a performance without asking. After switching, call " +
      "get_status to confirm the input level actually came up - opening a device successfully " +
      "does not mean sound is arriving on it. " +
      "\n\n" +
      "Docs note: if the newly selected device hears nothing on macOS, the usual cause is the " +
      "routing rather than the choice - audio has to be sent to the virtual device, and a " +
      "Multi-Output Device is what keeps it audible at the same time. read_doc audio-input.",
    args: {
      name:
        "Exact device name from list_audio_devices.",
      type:
        "Driver type, e.g. CoreAudio. Usually unnecessary.",
    },
  },
  tap_tempo: {
    title: "Restart the beat grid",
    description:
      "Restart the beat cycle at this instant, exactly like the app's \"Tap for 1\" button. Every " +
      "modulator set to fire every n beats re-anchors here, so a group that has drifted out of " +
      "phase with the music lines up again. Use it when beat-driven output is landing on the " +
      "wrong beat rather than not firing at all - if it is not firing, describe_modulator will " +
      "show that. " +
      "\n\n" +
      "Docs note: this also restarts the beat-modulo cycle for every modulator counting beats, " +
      "so modulators set to fire every n beats begin their cycle from the tap.",
  },
  list_patches: {
    title: "List saved patches",
    description:
      "List the saved AudioSlice configurations by name. Call this before load_patch so you can " +
      "offer real names, and before save_patch so you do not silently overwrite one.",
  },
  save_patch: {
    title: "Save the current configuration",
    description:
      "Save the entire current configuration - every output and modulator - under a name, so it " +
      "can be restored later. Worth doing before any substantial reconfiguration, so there is a " +
      "way back. Saving over an existing name replaces it, so check list_patches first.",
    args: {
      name:
        "A name using letters, numbers, spaces, hyphens and underscores only (max 64).",
    },
  },
  load_patch: {
    title: "Load a saved configuration",
    description:
      "DESTRUCTIVE: replace the ENTIRE current configuration with a saved patch. Every existing " +
      "output and modulator is torn down and rebuilt, and anything not saved is lost. Always " +
      "confirm with the user first, and offer to save_patch the current state before " +
      "proceeding. Never call this during a live performance without explicit agreement - it " +
      "interrupts all output while the rebuild happens.",
    args: {
      name:
        "Patch name from list_patches.",
    },
  },
  set_audioslice_token: {
    title: "Save the AudioSlice API token",
    description:
      "Store the API token so this extension can talk to AudioSlice. Only needed if AudioSlice " +
      "has a token configured - by default it does not, and everything works with no setup. " +
      "Call this when a tool reports a 401, after asking the user to copy the token from " +
      "AudioSlice's Advanced settings. It is saved locally and reused in future conversations.",
    args: {
      token:
        "The token from AudioSlice > Advanced settings.",
    },
  },
};

export const PROMPTS = {
  what_can_i_do: {
    title: "What can I do with this track?",
    description:
      "Analyse what is playing and suggest what to drive with it.",
  },
  setup_beat_lighting: {
    title: "Set up beat-synced lighting",
    description:
      "Create beat-driven OSC triggers, staggered so they do not collide.",
  },
  debug_no_output: {
    title: "Why isn't my OSC arriving?",
    description:
      "Work through why a receiver is showing nothing.",
  },
  review_setup: {
    title: "Review my current setup",
    description:
      "Audit the existing configuration for problems.",
  },
  connect_visuals_app: {
    title: "Connect me to Resolume / TouchDesigner / Synesthesia",
    description:
      "Set up OSC output for a specific visuals application, using its own guide.",
  },
};

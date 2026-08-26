# Resolume

Resolume Arena and Avenue can map any incoming OSC message onto almost any
control in the interface, so AudioSlice can drive clip playback, effect
parameters, opacity and transitions.

## Enable OSC input

1. **Preferences → OSC**.
2. Tick **OSC Input**, and note the **incoming port** (Resolume's default is `7000`).
3. Set AudioSlice to send to `127.0.0.1` on that port, or the machine's LAN IP if Resolume is on another computer.

## Mapping a signal to a control

Resolume learns mappings rather than making you type addresses:

1. Enter **Shortcuts → OSC** (application menu).
2. Click the parameter you want to control — a fader, an effect knob, a clip.
3. Send the signal from AudioSlice (i.e. play music so the value moves). Resolume
   captures the incoming address and binds it.
4. Set the **range** for that mapping, then leave shortcut mode.

The range step is the one people skip. AudioSlice sends `0–1`; if the parameter's
useful musical range is the top third, set it there and the same signal suddenly
feels intentional rather than twitchy.

::: tip Onsets versus loudness
Map **onsets** to things that should fire — clip triggers, strobes, cuts. Map
**loudness** to things that should breathe — opacity, scale, effect depth.
Swapping the two is the most common reason a mapping feels wrong.
:::

## Tempo

For beat-synced clips and effects, use Ableton Link to sync Resolume to the beat grid. 

See [Tempo](/audioslice/tempo).

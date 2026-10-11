# Resolume

Resolume Arena and Avenue can map any incoming OSC message onto almost any
control in the interface, so AudioSlice can drive clip playback, effect
parameters, opacity and transitions.

## Enable OSC input

1. **Preferences → OSC**.
2. Tick **OSC Input**, and note the **incoming port** (Resolume's default is `7000`).
3. Set AudioSlice to send to whatever IP address Resolume lists (usually something like `192.168.1.134`), or the machine's IP if Resolume is on another computer.

## Quick tutorial: Audioreactive monsters

In this tutorial you will:

- Map discrete individual drum hits to make clips or layers appear and disappear
- Map continuous stem energy to brightness or effect parameters
- Isolate individual modulator outputs in AudioSlice to slowly build your scene
- Use the TouchDesigner network to "see" what the network is thinking

Whoops: note that in the first few seconds the "snare" monster is not armed, but in the rest of the video after that, the "snare monster" clip is armed and properly appears with the rest of the hits!

<iframe width="560" height="315" src="https://www.youtube.com/embed/-k19Pf4hcqA?si=1eVamDFAjxKbPlBP" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>

## Tempo

For beat-synced clips and effects, use Ableton Link to sync Resolume to the beat grid. 

See [Tempo](/audioslice/tempo).

# Audio input

AudioSlice uses only raw audio as an input. No ProDJ link, Ableton Link, or click track necessary. 

It will need to be clean audio from an application on your computer or from an audio interface, though. Microphone input won't quite cut it yet (give us until our next model :)).

But whether you are using audio from Spotify, VLC, iTunes, Rekordbox, Ableton, or a browser tab, the AudioSlice experience is easy to route on both Mac OS X and Windows. 

## Gain staging

In general, try to turn up your source audio as high as you can. 

AudioSlice has an automatic gain control (AGC) to keep the audio's gain in the happy spot for the model, and the AGC can always turn the audio down. But if the source audio is too quiet, bit depth is not on your side. This could affect model performance. 

We recommend both keeping our AGC on as well as our sidechaining corrector on, which are the defaults:

![](/audio_input/agc.webp)

## Capturing system audio (macOS)

macOS has no built-in way to send one app's output into another, so you need a virtual audio device. Any of these work:

- **[BlackHole](https://existential.audio/blackhole/)**: free, open source, 2ch or 16ch.
- **Loopback** (Rogue Amoeba): paid, with a UI for routing and monitoring.

We recommend and love Blackhole. 

The catch: send audio to the virtual device and you stop hearing it. Fix that with a **Multi-Output Device**.

### Setting up a multi-output device

So that both you and AudioSlice can _hear_ the music at the same time, you'll need a Multi-Output Device. On macOS, open up `Audio MIDI Setup`.

1. `Audio MIDI Setup`
2. Click `"+"` icon at bottom left, select `Create Multi-Output Device`
3. Check the outputs you want (ie: Blackhole and your laptop speakers)
4. Keep sample rate at 44.1kHz, drift correction doesn't matter
5. Rename your new multi-output device something legible
6. `macOS settings` > `Sound` > `Output & input` > `Outpu`t > `Blackhole` > slide the volume all the way up

![](/audio_input/multi_output_device.webp)

![](/audio_input/blackhole_volume.webp)

Now play some music, and it should be output both to your speakers AND to Blackhole or Amoeba Loopback.

Once you have this set up, open up AudioSlice and go to `Audio Settings`

![](/audio_input/settings.webp)

and then choose your new output device:

![](/audio_input/input_device_selector.webp)

Once this is done, play some music, and you should be able to see volume both right next to the input device 

![](/audio_input/volume_input_device.webp)

as well as in the `Home` view of the app:

![](/audio_input/home.webp)

## Capturing system audio (Windows)

We are beyond proud that for routing audio on Windows, you only need AudioSlice. 

> You DO NOT need [VB-Audio Cable](https://vb-audio.com/Cable/) or Voicemeeter Banana!

AudioSlice on Windows will automatically detect via loopback which of your devices in outputting audio. And if it gets it wrong, you can just select a new one using the audio input selector dropdown in `Audio Settings`. 

It's that easy!

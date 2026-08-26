# Tempo

AudioSlice tracks the beat from the audio itself. 

No tapping, no click track, no timecode: it follows tempo changes live as the set moves.

It also tracks not only beats, but downbeats, and knows beat 1 vs 2, 3, or 4. 

## Beat and tempo tracking

Tracking runs on the same audio you selected in [Audio input](/audioslice/audio-input) and produces a tempo and a beat grid. 

Give it a bar or two of steady material to settle on a new track. Sparse intros and ambient passages have less to lock onto than a four-on-the-floor groove.

## Tempo settings

We recommend keeping the defaults here. 

However if you do know your music skews higher or lower in terms of BPM (say hip hop vs drum & bass) you can adjust the bias for the realtime beat tracker to prefer slower or faster beat grids. 

![](/tempo/settings.webp)

## Ableton Link

AudioSlice can share tempo **and beat phase** across every Ableton Link-enabled app on the network. Enable it on both ends and they negotiate automatically — there's no host to pick and nothing to configure.

It works in both directions:

- **AudioSlice as the source**: AudioSlice beat grid drives Ableton Live, Resolume or anything else on the session.
- **AudioSlice as a follower**: if Live is already the clock, AudioSlice locks to it instead of deriving its own.

## Setting your clock source

AudioSlice defaults to the realtime beat tracker, but if you'd prefer AudioSlice follow an Ableton Link source, or just click on an endless metronome, you can select that, too.

![](/tempo/clock_source.webp)

## See also

- [Output groups](/audioslice/output-groups): getting the signals across
- [BeatSage](/beatsage/): if tempo is *all* you need, it's a more accurate model and it works **on microphone input** in high SPL environments

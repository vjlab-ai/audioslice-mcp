# Envelope creator

Turn your modulators into ADSR-like envelopes!

## Example: quarter note beat release shape

Here we see an example with:

* `Sync`: use musical beat grid-relevant durations (quarter note release)
* No `attack` or `sustain`, `1/4` note `release`
* `Retrigger` is enabled (the envelope can be retriggered while an old one is still ending)

![](/modulators/beat_env_float.webp)

Note that `Switch` mode and the output `INT` type are NOT possible options when using envelopes, for obvious reasons.

> You can also use `ms` instead for the ADSR durations, but we recommend the musical ones since they will adapt to changing BPM better.

# TouchDesigner

TouchDesigner is the most common integration with AudioSlice due to its realtime speed and endless flexibility and modularity. 

## AudioSlice official `.tox`

Just drop it into your TouchDesigner network, set the `host` and `port` to whatever AudioSlice is sending to, and you will have messages streaming in. 

## Example .tox project

This is the best way to get started with TouchDesigner and AudioSlice. 

Find `td_demo.toe` in your download folder of AudioSlice. To use it:

* Open `td_demo.toe` in TouchDesigner
* In AudioSlice, `File > Open` the `touchdesigner_audioslice_config.json` config 
* Play some music, ensure that AudioSlice is hearing it (see [Audio Input](/audioslice/audio-input)) 

You'll be able to see a realtime visualization of drum hits, vocal and bass energy and pitch, as well as beats, pan, spread, and more. 

![](/td/demo.webp)

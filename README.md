[Play Zen Sandbox](https://zen-sandbox-drawing-game.vercel.app)
# The Zen Sandbox (Prototype)

A minimalist, desktop-first cellular automata toy focused on calm interaction and satisfying material flow.

## Run

1. Open this folder in VS Code.
2. Start a local static server in this folder (for best browser compatibility):
   - `python -m http.server 5500`
3. Open `http://localhost:5500`.

You can also open `index.html` directly, but some browsers restrict audio in `file://` pages.

## Current Materials

- Sand: heavy granular material, falls and settles, displaces fluids.
- Water: medium fluid, falls and spreads sideways with low viscosity.
- Smoke: light gas, rises and dissipates over time.
- Stone: static obstacle, never moves.
- Fire: transient hot pixel, rises slightly, ignites nearby oil, turns into smoke.
- Oil: viscous fluid, burns into fire and flows more slowly than water.

## Input

- Left mouse drag: paint active material
- Right mouse drag: erase
- Space: pause / unpause simulation
- Brush slider: brush radius
- Calm Speed slider: simulation substeps per frame

## Architecture Notes

- Grid model: fixed-size low-resolution simulation grid for speed.
- Render model: nearest-neighbor upscale to full window for a crisp pixel aesthetic.
- Update order: bottom-up with alternating horizontal scan direction per frame to reduce bias.
- Performance approach: typed arrays (`Uint8Array`) for cache-friendly cell storage.
- Feedback approach: subtle material-tinted color jitter + low-volume filtered noise bursts while painting.

## Next Suggested Iteration

- Add chunked dirty-region rendering so large canvases redraw only changed cells.
- Add a temperature field for richer fire/water/oil interactions.
- Add layered ambient audio bed tied to scene entropy for stronger ASMR feel.

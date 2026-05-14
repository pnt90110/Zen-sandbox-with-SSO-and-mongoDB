[Play Zen Sandbox](https://zen-sandbox-drawing-game.vercel.app)
# The Zen Sandbox (Prototype)

A minimalist, desktop-first cellular automata toy focused on calm interaction and satisfying material flow.

## Run

1. Open this folder in VS Code.
2. Install dependencies:
   - `npm install`
3. Copy `.env.example` to `.env` and fill the values.
4. Start the app server:
   - `npm run dev`
5. Open `http://localhost:8000`.

This app now runs through `server.js` so it can use SSO and MongoDB APIs.

## SSO + MongoDB Setup

The server uses OpenID Connect (OIDC) for SSO and stores each user's sandbox state in MongoDB.

### 1) Create an OIDC app in your IdP

You can use Auth0, Okta, Azure Entra ID, Keycloak, etc.

- Callback URL: `http://localhost:8000/callback`
- Logout URL / post-logout redirect: `http://localhost:8000`
- Response type: Authorization Code
- Scopes: `openid profile email` by default, or `openid` if your IdP only allows that
- Optional redirect override: set `OIDC_REDIRECT_URI` in `.env` when your IdP expects a URI that differs from `BASE_URL/callback`

### 2) Create MongoDB Atlas database

- Create a cluster and database user.
- Allow your local IP or use a secure network path.
- Copy the connection string.

### 3) Fill `.env`

Required values:

- `SESSION_SECRET`
- `OIDC_ISSUER_BASE_URL`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `MONGODB_URI`

Optional values:

- `OIDC_SCOPE` (default `openid profile email`)
- `OIDC_REDIRECT_URI` (default `BASE_URL/callback`)
- `OIDC_AUDIENCE`
- `MONGODB_DB` (default `zen_sandbox`)
- `MONGODB_COLLECTION` (default `sandbox_states`)

### 4) Use it in the UI

- Click **Sign In**.
- Paint normally.
- Click **Save to Cloud** to store your state in MongoDB.
- Click **Load from Cloud** to restore your latest saved state.

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

# Cosmic Playground

An interactive 3D lab for learning gravity, orbits and rocket flight. Two labs share one stage:

- **Spacetime Lab**: place stars, planets, black holes, neutron stars, asteroids and comets on a sheet that bends with mass. Aim each launch by dragging, see the predicted path before you commit (green stays in orbit, amber escapes, red ends in a collision), and read live orbital elements for any body.
- **Rocket Lab**: configure a two-stage launch vehicle, set the weather and planet, then fly it. A flight director tracks the phases of ascent, aerodynamic heating and dynamic pressure (Max-Q), a coach explains what is happening, and a mission report shows what went right or wrong, with a forensic rewind for failures.

Time can run from −4× (rewind) to 64× (warp). Objectives award exploration points, which unlock a Gravity Slingshot template (500 points) and a Mars dust-storm ascent scenario (750 points). Progress is saved in the browser.

See [docs/user-guide.md](docs/user-guide.md) for how to use it, and [CREDITS.md](CREDITS.md) for fonts and libraries.

## Getting started

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:8080.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run assets:optimize` | Compress 3D models from `assets-src/` into `public/models/` |

## How it is built

React 18, TypeScript and Vite; 3D with three.js and React Three Fiber; state in zustand; animation with GSAP; styling with Tailwind CSS.

```
src/
  app/        Background watchers (objectives, flight recorder), error boundaries
  hud/        Everything on screen over the 3D view
  motion/     GSAP setup: plugins, eases, reduced-motion handling
  sim/        Simulation maths with no rendering: N-body gravity, rocket flight,
              time scheduling (warp/rewind), orbit prediction (runs in a worker),
              orbital elements, display units
  stage/      The single WebGL canvas, per-lab "worlds", post-processing, materials
  stores/     zustand stores: app, time, spacetime, rocket, flight, progress, events
  worlds/     3D content for each lab
  test/       Unit tests
```

Design notes:

- **One canvas, two worlds.** Both labs stay mounted as R3F portals with their own scene and camera; only the active one renders, takes input and shows labels. The hidden lab pauses.
- **Physics is separate from rendering.** `src/sim` holds the integrators as pure functions. Warp runs more of the same fixed steps per frame (within a work budget), so 64× gives the same result as 64 times as many 1× frames; tests check this.
- **The spacetime sheet is drawn on the GPU** from a softened (Plummer) well field. The same formula runs on the CPU so bodies, trails and predicted paths sit on the surface. It is a visual aid; the physics runs on a flat plane.
- **Graphics quality** has High, Medium and Low tiers (resolution and post-processing). Auto steps down when the frame rate stays low.
- **Rendering guardrails.** The effect composer keeps `multisampling={0}` and has no ToneMapping effect, and shaders that feed Bloom never produce NaN. Each of these once turned whole frames black on ANGLE/D3D11.

## Simplifications to be aware of

This is a teaching model, not a mission planner.

- Spacetime Lab scales gravity so solar-system masses produce motion at scene distances. Speeds and distances are in scene units (u, u/s).
- Rocket Lab uses explicit Euler integration with simplified drag, wind and heating. Altitude is shown in km on the scene's atmosphere-layer scale; speed is in model units with its fraction of the model's escape speed. There is no aerodynamic lift, and stage separation is visual only (mass does not change).

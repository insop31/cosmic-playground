# Cosmic Playground

Cosmic Playground is a 3D physics lab for students. Textbooks present physics as finished results; here students run their own experiments, predict what will happen, watch it succeed or fail, and work out why. Two labs share one stage:

- **Spacetime Lab**: place stars, planets, black holes, neutron stars, asteroids and comets on a sheet that bends with mass. Aim each launch by dragging, see the predicted path before you commit (green stays in orbit, amber escapes, red ends in a collision), and read live orbital elements for any body.
- **Rocket Lab**: configure a two-stage launch vehicle, set the weather and planet, predict the outcome, then fly it. A flight director tracks the phases of ascent, aerodynamic heating and dynamic pressure (Max-Q), a coach explains what is happening, and a mission report says what happened, why, and what to try next.

Nothing stops a bad choice: a planet can crash into its star and a rocket can burn up. Every failure is explained with numbers, and both labs can be rewound.

A printable guide for students and teachers is in [`docs/Cosmic_Playground_User_Guide.pdf`](docs/Cosmic_Playground_User_Guide.pdf) (source: [docs/user-guide.md](docs/user-guide.md)). Fonts and libraries are credited in [CREDITS.md](CREDITS.md).

## Features

### Spacetime Lab
- **N-body gravity in real units**: every body pulls on every other. Masses are in kilograms, 1 AU is 8 grid squares and a year is the time an orbit at 1 AU takes. The simulation runs in a background worker with a fixed 1/120 s leapfrog step that splits into smaller sub-steps during close encounters.
- **Realistic and arcade gravity**: arcade mode uses 4× stronger gravity and a speed cap, so orbits keep their shape but play out faster.
- **Collisions judged by physics**: slow impacts merge, faster ones bounce and violent ones shatter, decided by the impact speed compared with the pair's escape speed. Black holes swallow what crosses the event horizon and tear apart bodies inside the Roche limit. Each impact is explained with the momentum kept and the energy released.
- **Predict before you place**: a preview computed with the simulation's own physics shows where a body will go. Drag to aim it with your own velocity.
- **Time from −4× to 64×**: warp runs more of the same fixed steps per frame, so 64× gives exactly the same result as 64 times as many frames at 1× (tests check this). Scrub back through the last 30 s of simulated time, with markers at every impact.
- **Body inspector**: distance, speed, circular and escape speed, eccentricity, period, closest and farthest points and Kepler's T² ÷ a³, live and in real units. Bodies can be pinned in place.
- **Conservation panel**: energy, momentum and angular momentum over time.
- **Building systems**: real planets plus stars, black holes, neutron stars, asteroids and comets; ready-made templates; saved systems.
- **Universe expansion (optional)**: unbound bodies drift apart while orbits held by gravity keep their size.

### Rocket Lab
- **Flight model**: gravity falls off with distance, the air thins exponentially with height, drag acts relative to the wind, thrust follows the rocket equation, and the rocket flies a gravity turn. With two stages, the empty first stage drops away and the second stage burns at the top of the climb.
- **Launch settings** for the vehicle, the atmosphere and the planet, and **eight weather conditions**. Sliders show the value actually flown after weather; some weather brings hazards such as lightning strikes or frozen seals.
- **Outcomes from physics**: orbit, escape, falling back, crash or burn-up, judged from orbital energy and the lowest point of the path.
- **Vehicle readout**: Δv budget, thrust-to-weight ratio and burn times before launch. Force vectors (gravity, thrust, drag, wind) can be shown on the vehicle during flight.
- **Rewind**: step back through a flight at any speed, or jump 5 s back from the report to see what went wrong.

### Learning loop
- **Predict first**: choose the outcome you expect before each launch; the report says whether you were right.
- **Debrief**: every flight ends with what happened, why (with numbers) and one specific change to try next.
- **Launch coach**: reads live telemetry during the flight (Max-Q, heating, staging, how much sideways speed an orbit still needs).
- **Lab notebook**: every launch is recorded with its settings, weather, prediction and cause. Tick two runs to compare exactly what changed.
- **Objectives judged from the simulation**: 20 objectives in 11 courses, such as keeping planets in orbit for three laps, a real gravity-assist speed gain, or a predicted impact that comes true. Points unlock a Gravity Slingshot template (500) and a Mars dust-storm ascent (750). Progress is saved in the browser.
- **Teacher packs**: five lessons (Kepler's laws, gravity assists, black holes and tides, the rocket equation, weather and launch safety), each with notes for the teacher and a one-click starting setup.
- **Share files**: export saved systems and rocket presets to a file and import them on another computer. Imported files are validated first.

### Accessibility and performance
- **Keyboard**: Space pauses or plays, ← and → change speed (left of 0 rewinds), R resets the current lab, 1 and 2 pick a lab, Tab switches labs when nothing is focused, Esc cancels placing or closes the inspector, L and M open objectives and the mission log, H hides the interface, ? opens help.
- **Help and settings** (top right): graphics quality (Auto steps down when the frame rate stays low), motion (follows the system setting by default, or Reduced or Full) and high contrast.
- **Fast first load**: the interface loads first (about 240 KB of compressed script); the 3D engine loads behind the intro. CI fails if the first-load script grows past 300 KB.

## Getting started

Requires [Node.js](https://nodejs.org/) 20.19+ or 22.12+ (the current LTS release works), with `npm`. Check with `node -v`: Vite 7 does not run on Node 18 or 21.

```bash
git clone https://github.com/insop31/cosmic-playground.git
cd cosmic-playground
npm install
npm run dev
```

Then open http://localhost:8080. To update an existing copy, run `git pull` and then `npm install` again, since dependencies change between versions.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server on port 8080 with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests (Vitest): physics, warp, prediction, rocket model, objectives, debrief, storage |
| `npm run test:e2e` | End-to-end browser tests against the production build (run `npx playwright install chromium` once first) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run check:bundle` | Check the first-load script against the 300 KB budget (after `npm run build`) |
| `npm run docs:guide` | Rebuild the PDF guide from `docs/user-guide.html` |
| `npm run assets:optimize` | Compress 3D models from `assets-src/` into `public/models/` |

GitHub Actions runs the type check, lint, unit tests, build, bundle budget and end-to-end tests (`.github/workflows/ci.yml`).

## Deploying

The app is a static site: `npm run build` writes everything to `dist/`, with no server or secrets needed. On [Vercel](https://vercel.com), import the repository (**Add New → Project**) and deploy; `vercel.json` sets the build, the output folder, a fallback to `index.html` for unknown paths, and long-term caching for the hashed files in `dist/assets`. The `engines` field in `package.json` makes Vercel use a Node.js version that Vite supports. Every push to `main` then redeploys, and pull requests get preview links.

## How it is built

React 18, TypeScript and Vite; 3D with three.js and React Three Fiber; state in zustand; animation with GSAP; styling with Tailwind CSS and Radix UI primitives; zod validates imported files.

```
src/
  app/        Background watchers (objectives, flight recorder), error boundaries
  hud/        Everything on screen over the 3D view
  learning/   Debrief, launch coach and simulation-based objective checks
  lib/        Courses and packs, storage, notebook, file sharing
  motion/     GSAP setup, reduced-motion preference
  physics/    Simulation code with no rendering (unit-tested): N-body gravity and
              collisions, the fixed-step core with rewind history, warp scheduling,
              orbit prediction, orbital elements, the rocket flight model
  workers/    The simulation worker and the prediction worker
  stage/      The single WebGL canvas, per-lab "worlds", post-processing, materials
  stores/     zustand stores: app, time, sim, spacetime, rocket, flight, progress, events
  worlds/     3D content for each lab
  test/       Cross-module tests (warp equality, predictor, stores)
e2e/          Playwright end-to-end tests
docs/         User guide (Markdown, HTML and PDF)
```

Design notes:

- **One canvas, two worlds.** Both labs stay mounted as R3F portals with their own scene and camera; only the active one renders, takes input and shows labels. The hidden lab pauses.
- **Physics is separate from rendering.** The N-body core runs in a worker and the page draws its snapshots. Placement previews run the same integrator in a second worker, so a preview matches what then happens. Rocket flights step the same fixed-step model as the trajectory preview.
- **Warp has a work budget.** Each frame may run a limited number of steps (fewer when there are many bodies). If 64× would need more, the clock slows down and the speed readout says so, rather than taking bigger, less accurate steps.
- **The spacetime sheet is drawn on the GPU** from a softened (Plummer) well field. The same formula runs on the CPU so bodies, trails and predicted paths sit on the surface. It is a visual aid; the physics runs on a flat plane.
- **Rendering guardrails.** The effect composer keeps `multisampling={0}` and has no ToneMapping effect, and shaders that feed Bloom never produce NaN. Each of these once turned whole frames black on ANGLE/D3D11.

## Simplifications to be aware of

This is a teaching model, not a mission planner.

- The Spacetime Lab runs on a flat plane, and time is compressed: at 1× an Earth year passes in about 45 seconds.
- The Rocket Lab flies over a small planet in scene units. Altitude is shown in km on the scene's atmosphere-layer scale, so its scale changes with height; speed is in model units with its fraction of the escape speed. Wind is exaggerated so its effect is visible, and there is no aerodynamic lift.

# Cosmic Playground 🚀✨

Cosmic Playground is a 3D physics sandbox for students. Textbooks present physics as finished results; here students run their own experiments, predict what will happen, watch it succeed or fail, and work out why. They place stars, planets and black holes in a gravity lab, or tune and launch a rocket through changing weather. Nothing stops a bad choice: a planet can crash into its star and a rocket can burn up. Every failure is explained with numbers, and the gravity lab can be rewound.

A printable guide for students and teachers is in [`docs/Cosmic_Playground_User_Guide.pdf`](docs/Cosmic_Playground_User_Guide.pdf).

## 🌟 Features

### Spacetime Lab (gravity sandbox)
- **N-body gravity in real units**: every body pulls on every other. Masses are in kilograms, 1 AU is 8 grid units and a year is the time an orbit at 1 AU takes. The simulation runs in a background worker with a fixed 1/120 s leapfrog step that splits into smaller sub-steps during close encounters.
- **Realistic and arcade gravity**: arcade mode uses 4× stronger gravity and a speed cap, so orbits keep their shape but play out faster.
- **Collisions judged by physics**: slow impacts merge, faster ones bounce, and violent ones shatter into fragments, all decided by the impact speed compared with the pair's escape speed. Black holes swallow what crosses the event horizon and tear apart bodies that stray inside the Roche limit. Each impact is explained in a pop-up with the momentum kept and the energy released.
- **Predict before you place**: while placing a body, a preview line shows where it will go (green orbit, yellow escape, red impact). Drag to aim a body with your own velocity.
- **Timeline and rewind**: scrub back through the last 30 s of simulated time, with markers at every impact.
- **Orbit inspector**: click a body to see its orbit (period, eccentricity, closest and farthest points, T² ÷ a³) and the conic it will follow. Bodies can be pinned in place.
- **Conservation panel**: energy, momentum and angular momentum over time, so students can see what is conserved and when it is not.
- **Spacetime grid**: the grid bends under every mass in real time.
- **Building systems**: 8 real planets plus stars, black holes, neutron stars, asteroids and comets; 7 ready-made templates; saved systems.
- **Universe expansion (optional)**: unbound bodies drift apart while orbits held by gravity keep their size.

### Rocket Lab (launch simulator)
- **Flight model**: gravity falls off with distance, the air thins exponentially with height, drag acts relative to the wind, thrust follows the rocket equation, and the rocket flies a gravity turn. With two stages, the empty first stage drops away and the second stage burns at the top of the climb.
- **18 launch settings**: pitch-over angle, thrust, burn time, fuel, dry mass, drag, air density, crosswind, wind shear, thermal load, temperature, pressure, pad tilt, gravity, planet radius, stage separation, and stage 2 thrust and fuel share.
- **Eight weather conditions**: each changes the values flown (shown next to the slider) and some bring hazards such as lightning strikes or frozen seals.
- **Outcomes from physics**: orbit, escape, falling back, crash or burn-up, judged from orbital energy and the lowest point of the path. Telemetry shows dynamic pressure (Max-Q) and heat-shield load.
- **Vehicle readout**: Δv budget, thrust-to-weight ratio and burn times before launch.

### Learning loop
- **Predict first**: choose the outcome you expect before each launch; the result says whether you were right.
- **Debrief**: every flight ends with what happened, why (with numbers) and one specific change to try next.
- **Launch Coach**: reads live telemetry during the flight (Max-Q, heating, staging, how much sideways speed an orbit still needs).
- **Lab notebook**: every launch is recorded with its settings, weather, prediction and cause. Tick two runs to compare exactly what changed.
- **Missions judged from the simulation**: 20 missions in 11 packs, such as keeping planets in orbit for three laps, a real gravity-assist speed gain, or a predicted impact that comes true.
- **Teacher packs**: five lessons (Kepler's laws, gravity assists, black holes and tides, the rocket equation, weather and launch safety), each with notes for the teacher and a one-click starting setup.
- **Share files**: export saved systems and rocket presets to a file and import them on another computer. Imported files are validated first.

### Accessibility and performance
- **Keyboard shortcuts**: Space pauses or plays, R resets the current lab, Esc cancels placing a body, and Tab switches labs while a 3D view has focus (click it first, so Tab still moves through the panels).
- **Display settings** (gear icon, top right): graphics quality for slower school devices, reduce motion (follows the system setting by default) and high contrast.
- **Fast first load**: the panels load first (about 120 KB of compressed script); the 3D engine and the Rocket Lab load when they are needed. CI fails if the first-load script grows past 300 KB.

## 🛠️ Technologies Used

- **Framework**: [React 18](https://react.dev/) + [Vite](https://vitejs.dev/), [TypeScript](https://www.typescriptlang.org/)
- **3D graphics**: [Three.js](https://threejs.org/), [@react-three/fiber](https://docs.pmnd.rs/react-three-fiber), [@react-three/drei](https://github.com/pmndrs/drei)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) with two [Radix UI](https://www.radix-ui.com/) primitives (dialog, tooltip)
- **Validation**: [zod](https://zod.dev/) for imported files
- **Testing**: [Vitest](https://vitest.dev/) for unit tests, [Playwright](https://playwright.dev/) for end-to-end tests

## 🚀 Getting Started

### Prerequisites

[Node.js](https://nodejs.org/) 20.19+ or 22.12+ (the current LTS release works), with `npm`. Check with `node -v`: Vite 7 does not run on Node 18 or 21.

### Installation

```bash
git clone https://github.com/insop31/cosmic-playground.git
cd cosmic-playground
npm install
npm run dev
```

Then open `http://localhost:8080`.

To update an existing copy, run `git pull` and then `npm install` again, since dependencies change between versions.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server on port 8080 |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Lint all source files |
| `npm run typecheck` | Type-check the app without building |
| `npm test` | Unit tests: physics, rocket model, missions, debrief, storage |
| `npm run test:e2e` | End-to-end browser tests against the production build (run `npx playwright install chromium` once first) |
| `npm run check:bundle` | Check the first-load script against the 300 KB budget (after `npm run build`) |
| `npm run docs:guide` | Rebuild the PDF guide from `docs/user-guide.html` |

GitHub Actions runs the type check, lint, unit tests, build, bundle budget and end-to-end tests (`.github/workflows/ci.yml`).

## 🎮 How to Play

- **Spacetime Lab**: drag to orbit the camera and scroll to zoom. Pick an object in the left panel, then click the grid to drop it into a circular orbit, or press and drag to aim it. Watch the preview line before you let go. Click a body to inspect its orbit. Use the time bar to pause, speed up, rewind or scrub.
- **Rocket Lab**: switch to the Rocket tab, adjust the settings and weather, pick a prediction and press **Ignite**. After the flight, read the debrief, change one thing, and compare the runs in the notebook.
- **Teachers**: choose a teacher pack in the Mission Progress panel, read the notes and press **Load lesson setup**. Share prepared systems and rocket presets with **Export file** / **Import file**.

## 🗂️ Project Structure

```
src/
  physics/            Pure simulation code, no React (unit-tested)
    constants.ts      Gravity constants, unit rules, orbit helpers
    system.ts         Flat typed-array body storage
    nbody.ts          Integrator, collisions, tidal disruption, motion classification
    simulation.ts     Fixed-step core with rewind history and predictions
    orbits.ts         Orbital elements and conics
    rocket.ts         Rocket Lab flight model, outcomes and preview
  workers/            The simulation's background worker
  learning/           Debrief, Launch Coach and simulation-based mission checks
  components/space/   Spacetime Lab scene, grid, simulator, inspector, timeline, templates
  components/rocket/  Rocket Lab scene, model, controls, weather, lab notebook
  components/ui/      Panels, settings and the two Radix primitives
  lib/                Missions and packs, storage, notebook, file sharing, settings
  pages/Index.tsx     App shell and shared state
e2e/                  Playwright end-to-end tests
docs/                 User guide (HTML source and PDF)
```

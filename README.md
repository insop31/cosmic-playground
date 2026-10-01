# Cosmic Playground 🚀✨

Cosmic Playground is a 3D physics sandbox for students. Textbooks present physics as finished results; here students run their own experiments, watch them succeed or fail, and work out why. They place stars, planets and black holes in a gravity lab, or tune and launch a rocket through changing weather. Nothing stops a bad choice: a planet can crash into its star and a rocket can burn up, and every failure is explained and can be rewound.

## 🌟 Features

### Spacetime Lab (gravity sandbox)
- **N-body gravity**: every body pulls on every other, integrated with velocity Verlet at a fixed 1/120 s step that splits into smaller sub-steps during close encounters.
- **Realistic and arcade gravity**: arcade mode uses 4× stronger gravity and a speed cap. Orbits keep their shape but play out faster.
- **Collisions and black holes**: bodies merge while conserving momentum, and black holes swallow anything that crosses the event horizon. Each impact is explained in a pop-up and the camera frames it.
- **Rewind**: step back through up to 30 s of simulated time, including bodies that were absorbed in collisions.
- **Spacetime grid**: the grid bends under every mass in real time.
- **Building systems**: 8 real planets plus stars, black holes, neutron stars, asteroids and comets, a placement-speed slider, 6 ready-made system templates, and saved systems.
- **Universe expansion (optional)**: unbound bodies drift apart while orbits held by gravity stay the same size.

### Rocket Lab (launch simulator)
- **16 launch settings**: launch angle, thrust, burn time, fuel, dry mass, drag, air density, crosswind, wind shear, thermal load, temperature, pressure, pad tilt, gravity, planet radius and two-stage separation.
- **Eight weather conditions**: each changes the settings actually flown and has its own visual effects and pre-launch briefing.
- **Outcomes from physics**: stable orbit, escape, suborbital, crash or burn-up. Orbit and escape are judged from orbital energy and the lowest point of the orbit. Every outcome comes with a plain-language reason.
- **Trajectory preview**: the preview uses the same flight model and time step as the real launch.
- **Launch coach, telemetry and presets**: the coach gives hints, flight readouts include heat-shield load, and launch settings can be saved as presets.

### Progress
- 14 missions across 4 challenge packs, an exploration score and a run counter.

## 🛠️ Technologies Used

- **Framework**: [React 18](https://react.dev/) + [Vite](https://vitejs.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **3D Graphics**: [Three.js](https://threejs.org/), [@react-three/fiber](https://docs.pmnd.rs/react-three-fiber), [@react-three/drei](https://github.com/pmndrs/drei)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/) + [Radix UI](https://www.radix-ui.com/)
- **Testing**: [Vitest](https://vitest.dev/)

## 🚀 Getting Started

### Prerequisites

[Node.js](https://nodejs.org/) 18 or later, with `npm`.

### Installation

```bash
git clone https://github.com/insop31/cosmic-playground.git
cd cosmic-playground
npm install
npm run dev
```

Then open `http://localhost:8080`.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server on port 8080 |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Lint all source files |
| `npm run typecheck` | Type-check the app without building |
| `npm test` | Run the unit tests (physics, rocket model, storage) |

Pull requests run type check, lint, tests and build in GitHub Actions (`.github/workflows/ci.yml`).

## 🎮 How to Play

- **Spacetime mode**: drag to orbit the camera and scroll to zoom. Pick an object in the left panel, then click the grid to place it. Use the time bar to play, pause, speed up or rewind.
- **Rocket mode**: switch to the Rocket tab, adjust the settings and weather, and press **Ignite**. The dashed line previews the path. After the flight, read why it ended the way it did, change one thing, and try again.

## 🗂️ Project Structure

```
src/
  physics/            Pure simulation code, no React (unit-tested)
    constants.ts      Gravity constants, unit rules, orbit helpers
    nbody.ts          Spacetime Lab engine: integrator, collisions, classification
    rocket.ts         Rocket Lab flight model, outcomes and preview
  components/space/   Spacetime Lab scene, grid, simulator and templates
  components/rocket/  Rocket Lab scene, model, controls, weather
  components/ui/      Panels plus vendored shadcn/ui primitives
  lib/                Missions and saved scenarios/presets (browser storage)
  pages/Index.tsx     App shell and shared state
```

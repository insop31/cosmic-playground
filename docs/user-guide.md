# Cosmic Playground user guide

A printable version for students and teachers, with screenshots, is in [Cosmic_Playground_User_Guide.pdf](Cosmic_Playground_User_Guide.pdf).

## The screen

| Area | What it holds |
| --- | --- |
| Top bar | Lab switch, live readings, score, mission log, objectives, help and settings, hide interface |
| Left | Tool rail and the lab's tool panel; during a flight, the altitude and speed tapes |
| Top centre | The current message: placement prompt, paused, outcome, objective complete, unlock |
| Right | Body inspector or flight director, then objectives |
| Bottom | Time controls: reset, rewind, pause, faster, speed, clock, and the last 60 seconds of events |

The first visit opens with a short introduction where you pick a lab. Replay it from **Help and settings**.

## Spacetime Lab

**Add a body.** Pick one in **Bodies**, then:

- **Click** the sheet to place it on a circular orbit around the heaviest body. The *Placement velocity* slider scales that speed.
- **Press and drag** to aim the launch yourself. The arrow is the velocity; longer is faster.

Before you release, the dashed path shows where the body will go over the next 24 simulated seconds, computed with the same physics as the simulation: **green** stays in orbit, **amber** escapes, **red** ends in a collision (with the time to impact). While aiming, dragging sets the velocity instead of turning the view; scroll still zooms.

**Inspect a body.** Click it, or its row under *In the scene*. The camera flies to it and follows it (turn off **Follow** to look around freely). The inspector shows, in real units, its distance and speed relative to what it orbits, the speeds needed for a circular orbit and to escape, and the orbit's semi-major axis, eccentricity, period, closest and farthest points, and Kepler's T² ÷ a³ (the same for every planet of one star). **Pin** holds a body still while it keeps pulling on the others. Hover the ⓘ icons for explanations. **Esc** or clicking empty space closes it.

**What can happen.** Slow collisions merge, faster ones bounce and violent ones shatter, judged from the impact speed against the pair's escape speed. Black holes swallow what crosses the event horizon and tear apart bodies inside the Roche limit. Each impact is explained with the momentum kept and the energy released.

**Conservation** (top right) plots energy, momentum and angular momentum over time: flat while only gravity acts, with jumps at collisions.

**Systems** loads ready-made configurations. **Saved** stores your own.

**Realistic gravity** uses Newton's constant with real masses: 1 AU is 8 grid squares, and at 1× a year passes in about 45 seconds. Switching it off uses arcade gravity, 4× stronger with a speed cap. **Universe expansion** makes unbound bodies drift apart while orbits keep their size.

## Rocket Lab

**Set up** in three steps (the rail buttons jump to each):

1. **Vehicle**: thrust, burn time, fuel, dry mass, launch angle, stage separation. Watch the thrust-to-weight ratio: below 1 the rocket cannot leave the pad.
2. **Weather**: storms, wind, ice and more, with a briefing of what each changes, plus air density, drag, wind and temperature.
3. **Launch**: scenario, gravity, planet size, pad tilt, and the launch coach's advice.

Above **Ignite**, pick the outcome you expect: orbit, falls back, escape, crash or burn-up. A correct prediction scores points.

**Ignite** starts a three-second countdown (**Enter** launches now, **Esc** holds). During the flight:

- **Tapes** show altitude (km) and speed, with speed as a percentage of escape speed.
- **Flight director** marks the phases (liftoff, Max-Q, engine cutoff, reaching space, result), shows aerodynamic heating and dynamic pressure, and keeps the coach's commentary.
- **Force arrows** on the vehicle show thrust, gravity, drag and wind; longer arrows are stronger forces.

The verdict comes as soon as the outcome is certain, often before the top of the climb; the rocket then coasts on so you can watch it. The **mission report** says whether your prediction held, explains the outcome with numbers (*Why*), suggests one change (*Try next*), and shows an altitude chart and the key numbers. After a failure, **Rewind 5 s** plays the last moments backwards and pauses so you can watch what went wrong. **Fly again** repeats the same setup; **Change setup** reopens the panel.

**Lab notebook.** Every launch is written down with its settings, weather, prediction and cause. Open it from the report or the notebook icon at the top of Launch setup, and tick two runs to compare exactly what changed and what it did. Change one thing at a time.

## Time

| Control | Effect |
| --- | --- |
| Pause (Space) | Freezes the simulation; the scene greys slightly |
| ← / → | Step through speeds: −4×, −2×, −1×, −½×, ½×, 1×, 2×, 4×, 8×, 16×, 32×, 64× |
| Negative speeds | Rewind through recent history (at least the last 30 simulated seconds) |
| History bar | Spacetime Lab: drag to scrub back; markers show impacts |

64× gives exactly the same result as 64 times as many steps at 1×. Very crowded systems can't always run at full warp; the time controls then show the speed actually reached.

## Objectives and unlocks

Each lab has courses of objectives. Completing one, or trying a setup you haven't tried before, earns exploration points. Open the **Mission log** (M) to see every objective and your progress towards:

- **Gravity Slingshot** (500 points): a Spacetime template where a comet steals momentum from a giant planet.
- **Mars dust-storm ascent** (750 points): a Rocket Lab scenario with Mars gravity, thin air and a dust storm.

Objectives are judged from what really happens in the simulation: *Gravity Master* needs planets that stay in orbit for three laps of the outermost one, and *Slingshot Expert* a flyby that really raises a comet's speed.

Progress is saved in this browser. **Reset progress** is at the bottom of the mission log.

## For teachers

The course menu in the Objectives panel includes five **teacher packs**: Kepler's laws, gravity assists, black holes and tides, the rocket equation, and weather and launch safety. Each has notes with questions to ask and a **Load lesson setup** button that puts the right system or rocket on screen.

**Sharing set-ups.** Save a system (Spacetime Lab, *Saved* tab) or a rocket preset (Launch setup, *Saved setups*), then **Export file** downloads everything saved in this browser. **Import file** adds such a file on another computer; files are checked before anything is stored.

## Keyboard

| Key | Action |
| --- | --- |
| Tab | Switch labs (when nothing is focused) |
| 1 / 2 | Spacetime Lab / Rocket Lab |
| Space | Pause or resume |
| ← / → | Slower / faster |
| R | Reset the current lab |
| L | Show or hide objectives |
| M | Mission log |
| [ | Show or hide the tool panel |
| Esc | Cancel placement, close the inspector or a panel |
| H | Hide or show the interface |
| ? | Help and settings |

## Settings

**Graphics quality**: Auto adjusts to your device; High, Medium and Low trade resolution and glow for speed. Choose Low on older or integrated graphics.

**Motion**: System follows your device's setting; Reduced turns camera flights into cuts, stops camera shake and skips interface animations; Full keeps them.

**High contrast**: solid panels and brighter secondary text.

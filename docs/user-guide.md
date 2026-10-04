# Cosmic Playground user guide

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

**Inspect a body.** Click it, or its row under *In the scene*. The camera flies to it and follows it (turn off **Follow** to look around freely). The inspector shows its distance and speed relative to what it orbits, the speeds needed for a circular orbit and to escape, and the orbit's semi-major axis, eccentricity and period. Hover the ⓘ icons for explanations. **Esc** or clicking empty space closes it.

**Systems** loads ready-made configurations. **Saved** stores your own.

**Realistic gravity** uses Newton's constant with real masses (scaled to the scene); switching it off uses a simpler arcade constant.

## Rocket Lab

**Set up** in three steps (the rail buttons jump to each):

1. **Vehicle**: thrust, burn time, fuel, dry mass, launch angle, stage separation. Watch the thrust-to-weight ratio: below 1 the rocket cannot leave the pad.
2. **Weather**: storms, wind, ice and more, with a briefing of what each changes, plus air density, drag, wind and temperature.
3. **Launch**: scenario, gravity, planet size, pad tilt, and the launch coach's advice.

**Ignite** starts a three-second countdown (**Enter** launches now, **Esc** holds). During the flight:

- **Tapes** show altitude (km) and speed, with speed as a percentage of escape speed.
- **Flight director** marks the phases (liftoff, Max-Q, engine cutoff, reaching space, result), shows aerodynamic heating and dynamic pressure, and keeps the coach's commentary.
- **Force arrows** on the vehicle show thrust, gravity, drag and wind; longer arrows are stronger forces.

When the flight ends, the **mission report** explains the outcome and shows an altitude chart and the key numbers. After a failure, **Rewind 5 s** plays the last moments backwards and pauses so you can watch what went wrong. **Fly again** repeats the same setup; **Change setup** reopens the panel.

## Time

| Control | Effect |
| --- | --- |
| Pause (Space) | Freezes the simulation; the scene greys slightly |
| ← / → | Step through speeds: −4×, −2×, −1×, −½×, ½×, 1×, 2×, 4×, 8×, 16×, 32×, 64× |
| Negative speeds | Rewind through recent history (at least the last 30 simulated seconds) |

Very crowded systems can't always run at full warp; the time controls then show the speed actually reached.

## Objectives and unlocks

Each lab has courses of objectives. Completing one, or trying a setup you haven't tried before, earns exploration points. Open the **Mission log** (M) to see every objective and your progress towards:

- **Gravity Slingshot** (500 points): a Spacetime template where a comet steals momentum from a giant planet.
- **Mars dust-storm ascent** (750 points): a Rocket Lab scenario with Mars gravity, thin air and a dust storm.

Progress is saved in this browser. **Reset progress** is at the bottom of the mission log.

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

**Motion**: if your system asks to reduce motion, camera flights become cuts and interface animations are skipped.

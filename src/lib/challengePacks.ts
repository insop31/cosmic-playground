import type { RocketParams } from '@/worlds/rocket/rocketTypes';

export type AppMode = 'spacetime' | 'rocket';

export interface MissionDefinition {
  id: string;
  mode: AppMode;
  name: string;
  description: string;
  score: number;
}

/** Classroom guidance attached to a teacher pack. */
export interface TeacherGuide {
  /** What the lesson is about and what to ask students. */
  notes: string;
  /** Spacetime packs: the template that sets up the lesson. */
  templateId?: string;
  /** Rocket packs: settings to start from (anything not listed keeps its default). */
  rocketSettings?: Partial<RocketParams>;
}

export interface ChallengePack {
  id: string;
  mode: AppMode;
  name: string;
  description: string;
  missions: MissionDefinition[];
  /** Present on teacher packs: a curated lesson with a starting setup. */
  teacher?: TeacherGuide;
}

const CORE_PACKS: ChallengePack[] = [
  {
    id: 'spacetime-core',
    mode: 'spacetime',
    name: 'Core Lab',
    description: 'Foundational gravity experiments across templates, rewind, and system-building.',
    missions: [
      { id: 'gravity-master', mode: 'spacetime', name: 'Gravity Master', description: 'Keep a star with at least two planets in stable orbits for three trips of the outermost planet.', score: 140 },
      { id: 'time-bender', mode: 'spacetime', name: 'Time Bender', description: 'Use rewind in the spacetime lab to inspect a system backward through time.', score: 90 },
      { id: 'system-architect', mode: 'spacetime', name: 'System Architect', description: 'Keep five or more bodies all in bound orbits, with no collisions, for 30 seconds.', score: 95 },
      { id: 'mode-shifter', mode: 'spacetime', name: 'Mode Shifter', description: 'Switch the spacetime lab into arcade gravity mode to compare simulation styles.', score: 80 },
    ],
  },
  {
    id: 'spacetime-extremes',
    mode: 'spacetime',
    name: 'Extreme Gravity',
    description: 'High-risk scenarios with dense systems, black holes, and aggressive flybys.',
    missions: [
      { id: 'chaos-creator', mode: 'spacetime', name: 'Chaos Creator', description: 'Build a dense gravitational system with many active bodies.', score: 100 },
      { id: 'slingshot-expert', mode: 'spacetime', name: 'Slingshot Expert', description: 'Swing an asteroid or comet past a moving star (not the heaviest body) so the flyby speeds it up by 30% or more.', score: 110 },
      { id: 'black-hole-survivor', mode: 'spacetime', name: 'Black Hole Survivor', description: 'Keep two or more bodies in bound orbits around a black hole for 30 seconds without losing any.', score: 150 },
    ],
  },
  {
    id: 'spacetime-predict',
    mode: 'spacetime',
    name: 'Predict First',
    description: 'Make a prediction, then test it: use the orbit preview and the inspector like a scientist.',
    missions: [
      { id: 'kepler-check', mode: 'spacetime', name: "Kepler's Check", description: 'Inspect two bodies orbiting the same star and compare their T² ÷ a³ values.', score: 90 },
      { id: 'aimed-orbit', mode: 'spacetime', name: 'Aimed Orbit', description: 'Drag to aim a new body into an orbit that lasts at least one full lap.', score: 110 },
      { id: 'collision-course', mode: 'spacetime', name: 'Collision Course', description: 'Aim a body so the preview turns red, then watch the predicted impact happen.', score: 90 },
    ],
  },
  {
    id: 'rocket-orbital',
    mode: 'rocket',
    name: 'Orbital Academy',
    description: 'Build the fundamentals of orbit, escape, and precise launch tuning.',
    missions: [
      { id: 'first-stable-orbit', mode: 'rocket', name: 'First Stable Orbit', description: 'Tune the launcher well enough to achieve a stable orbit.', score: 120 },
      { id: 'escape-velocity-achieved', mode: 'rocket', name: 'Escape Velocity Achieved', description: 'Push the rocket past the planet for a full escape trajectory.', score: 130 },
      { id: 'precision-pilot', mode: 'rocket', name: 'Precision Pilot', description: 'Hit orbit or escape with a nearly level pad and light crosswind.', score: 100 },
      { id: 'staging-specialist', mode: 'rocket', name: 'Staging Specialist', description: 'Reach orbit or escape with stage separation enabled.', score: 110 },
    ],
  },
  {
    id: 'rocket-survival',
    mode: 'rocket',
    name: 'Weather Trials',
    description: 'Stress-test launch profiles in hostile atmospheric conditions and heavy-lift setups.',
    missions: [
      { id: 'storm-runner', mode: 'rocket', name: 'Storm Runner', description: 'Survive a difficult launch with strong crosswind, wind shear, and thermal load.', score: 120 },
      { id: 'heavy-lift', mode: 'rocket', name: 'Heavy Lift', description: 'Succeed on a launch using a high-thrust, high-fuel rocket profile.', score: 105 },
      { id: 'dense-atmosphere-run', mode: 'rocket', name: 'Dense Atmosphere Run', description: 'Complete a successful flight through thicker, higher-pressure air.', score: 95 },
    ],
  },
  {
    id: 'rocket-predict',
    mode: 'rocket',
    name: 'Predict First',
    description: 'Commit to a prediction before every launch, then check it against what happened.',
    missions: [
      { id: 'forecaster', mode: 'rocket', name: 'Forecaster', description: 'Correctly predict the outcome of three launches.', score: 110 },
      { id: 'failure-analyst', mode: 'rocket', name: 'Failure Analyst', description: 'Correctly predict a failure: a crash, a fall back or a burn-up.', score: 90 },
      { id: 'orbit-call', mode: 'rocket', name: 'Called It', description: 'Predict an orbit, then reach it.', score: 120 },
    ],
  },
];

const CORE_MISSIONS = new Map(CORE_PACKS.flatMap((pack) => pack.missions).map((mission) => [mission.id, mission]));
const reuse = (...ids: string[]) => ids.map((id) => {
  const mission = CORE_MISSIONS.get(id);
  if (!mission) throw new Error(`Unknown mission ${id}`);
  return mission;
});

// Teacher packs: one lesson each, with a starting setup and discussion prompts.
const TEACHER_PACKS: ChallengePack[] = [
  {
    id: 'lesson-kepler',
    mode: 'spacetime',
    name: "Lesson: Kepler's Laws",
    description: 'Outer planets take longer to orbit, and T² ÷ a³ is the same for every planet of one star.',
    teacher: {
      templateId: 'resonant-chain',
      notes: 'Students click two planets and read T² ÷ a³ in the inspector. Ask: why does the number match? What happens to it around a heavier star? Then have them drag-aim a new planet into a lasting orbit.',
    },
    missions: reuse('kepler-check', 'aimed-orbit', 'gravity-master'),
  },
  {
    id: 'lesson-slingshot',
    mode: 'spacetime',
    name: 'Lesson: Gravity Assists',
    description: 'A moving body can lend speed to a small one that swings past it, the trick space probes use.',
    teacher: {
      templateId: 'slingshot-lab',
      notes: 'Run the set-up and watch the comet leave the companion star faster than it arrived. Ask: where did the energy come from? Rewind and replay the flyby, then have students predict and aim their own.',
    },
    missions: reuse('slingshot-expert', 'time-bender', 'collision-course'),
  },
  {
    id: 'lesson-black-holes',
    mode: 'spacetime',
    name: 'Lesson: Black Holes and Tides',
    description: 'Orbits around a black hole follow the same rules, until a body strays too close and is torn apart.',
    teacher: {
      templateId: 'black-hole-halo',
      notes: 'Students keep bodies orbiting the black hole, then place one inside the Roche limit and watch the tidal stream. Ask: why does a black hole not "suck in" a body that is in orbit?',
    },
    missions: reuse('black-hole-survivor', 'system-architect', 'chaos-creator'),
  },
  {
    id: 'lesson-rocket-equation',
    mode: 'rocket',
    name: 'Lesson: The Rocket Equation',
    description: 'Fuel is heavy: doubling it does not double the speed, but dropping empty tanks helps a lot.',
    teacher: {
      rocketSettings: { stageSeparation: false, fuelMass: 80, thrustForce: 35 },
      notes: 'Start single-stage and record the Δv budget in the notebook. Ask students to predict what doubling the fuel does, test it, then turn on stage separation and compare the two runs side by side.',
    },
    missions: reuse('forecaster', 'staging-specialist', 'heavy-lift'),
  },
  {
    id: 'lesson-launch-weather',
    mode: 'rocket',
    name: 'Lesson: Weather and Launch Safety',
    description: 'Wind, heat and thick air decide whether a launch is safe, which is why real launches get scrubbed.',
    teacher: {
      rocketSettings: { stageSeparation: true, crosswind: 25, windShear: 0.6, thermalLoad: 0.5 },
      notes: 'The starting rocket faces strong wind and heating. Students predict a failure first, read the debrief, then change one setting at a time until the launch survives. Ask: which change mattered most?',
    },
    missions: reuse('failure-analyst', 'storm-runner', 'dense-atmosphere-run'),
  },
];

export const CHALLENGE_PACKS: ChallengePack[] = [...CORE_PACKS, ...TEACHER_PACKS];

export const ALL_MISSIONS = [...CORE_MISSIONS.values()];

export type AppMode = 'spacetime' | 'rocket';

export interface MissionDefinition {
  id: string;
  mode: AppMode;
  name: string;
  description: string;
  score: number;
}

export interface ChallengePack {
  id: string;
  mode: AppMode;
  name: string;
  description: string;
  missions: MissionDefinition[];
}

export const CHALLENGE_PACKS: ChallengePack[] = [
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

export const ALL_MISSIONS = CHALLENGE_PACKS.flatMap((pack) => pack.missions);

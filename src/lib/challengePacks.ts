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
      { id: 'gravity-master', mode: 'spacetime', name: 'Gravity Master', description: 'Run a wide range of spacetime experiments across bodies, velocity presets, and physics modes.', score: 140 },
      { id: 'time-bender', mode: 'spacetime', name: 'Time Bender', description: 'Use rewind in the spacetime lab to inspect a system backward through time.', score: 90 },
      { id: 'system-architect', mode: 'spacetime', name: 'System Architect', description: 'Assemble a stable-feeling system with at least five active bodies in play.', score: 95 },
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
      { id: 'slingshot-expert', mode: 'spacetime', name: 'Slingshot Expert', description: 'Fire an asteroid or comet into a high-speed gravity assist near a massive anchor.', score: 110 },
      { id: 'black-hole-survivor', mode: 'spacetime', name: 'Black Hole Survivor', description: 'Keep a living system active around a static black hole long enough to stabilize.', score: 150 },
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
];

export const ALL_MISSIONS = CHALLENGE_PACKS.flatMap((pack) => pack.missions);

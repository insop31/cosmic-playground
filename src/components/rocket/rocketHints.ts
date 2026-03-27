import { RocketParams, RocketState } from './rocketTypes';

export type HintScenario =
  | 'balanced-prelaunch'
  | 'angle-low'
  | 'angle-high'
  | 'thrust-low'
  | 'thrust-high'
  | 'fuel-low'
  | 'fuel-heavy'
  | 'burn-short'
  | 'burn-long'
  | 'drag-high'
  | 'crosswind-high'
  | 'windshear-high'
  | 'thermal-high'
  | 'dense-atmosphere'
  | 'thin-atmosphere'
  | 'gravity-high'
  | 'gravity-low'
  | 'pad-tilt-high'
  | 'stage-separation-on'
  | 'launching'
  | 'launching-risk'
  | 'coasting'
  | 'crashed'
  | 'suborbital'
  | 'orbiting'
  | 'escape';

// 27 normalized rocket situations x 5 variants each = 135 hardcoded hint lines.
export const AI_HINTS: Record<HintScenario, string[]> = {
  'balanced-prelaunch': [
    'This setup looks balanced. Launch it once as a control run before changing more sliders.',
    'Nothing is obviously broken here. A test launch now should give you useful feedback.',
    'This profile is in the safe middle. Use it as a baseline and tune from the result.',
    'The launch stack looks coherent so far. Try a run before over-optimizing.',
    'This is a reasonable starting build. Let the flight teach you what to fix next.',
  ],
  'angle-low': [
    'Your launch angle is shallow. Raise it a bit if the rocket keeps skimming the lower atmosphere.',
    'This pitch builds sideways speed early, but it may sacrifice too much climb.',
    'A low angle can help orbit later, but this one may flatten the ascent too soon.',
    'You are leaning hard into horizontal motion. Try a steeper start for more altitude.',
    'If the arc stays low and draggy, the first thing to raise is launch angle.',
  ],
  'angle-high': [
    'That launch angle is steep. Great for climbing, weaker for building orbital speed.',
    'A near-vertical ascent can waste energy fighting gravity. Flatten it slightly for orbit attempts.',
    'You will get altitude from this pitch, but not necessarily enough sideways speed.',
    'This looks more like a tall arc than an orbital insertion profile.',
    'If the rocket climbs well but falls back, the angle may be too high.',
  ],
  'thrust-low': [
    'Thrust looks weak. Gravity may win too much of the early climb.',
    'This engine setting is underpowered for an easy ascent. Add thrust before changing everything else.',
    'Low thrust can work, but it gives drag and gravity more time to punish the rocket.',
    'If liftoff feels sluggish, thrust is the first slider I would raise.',
    'This setup risks a slow climb. More thrust usually helps more than extra fuel alone.',
  ],
  'thrust-high': [
    'Thrust is aggressive here. That helps liftoff, but it can amplify drag and heating too.',
    'You have a lot of engine push dialed in. Great for brute force, not always for efficiency.',
    'High thrust can rescue a heavy rocket, but it can also make thick-air launches harsher.',
    'This engine setting is powerful. Pair it with a sensible angle so you do not waste it.',
    'Plenty of thrust here. If the rocket feels unstable, the issue may be guidance rather than power.',
  ],
  'fuel-low': [
    'Fuel reserves are light. The burn may end before the rocket has enough momentum.',
    'This is a lean propellant profile. Good for weight, risky for sustained climb.',
    'Low fuel can make the ascent die early even when the start looks fine.',
    'If the rocket peaks too soon, fuel mass is a strong candidate to increase.',
    'You do not have much burn margin here. Expect a short powered phase.',
  ],
  'fuel-heavy': [
    'Fuel mass is high. That gives endurance, but it also makes the rocket heavier.',
    'You are carrying a lot of propellant. Make sure thrust is strong enough to justify it.',
    'More fuel is not always more performance. Extra mass can blunt the early climb.',
    'This is a heavy stack. If the rocket feels slow off the pad, fuel weight is part of the problem.',
    'Heavy fuel builds work best when paired with a confident engine profile.',
  ],
  'burn-short': [
    'Burn duration is short. Expect a punchy start and an early handoff to coasting.',
    'This engine plan burns hot and brief. Good for impulse, risky for sustained ascent.',
    'A short burn can work, but only if the rocket gets enough energy up front.',
    'You are compressing the powered phase a lot. If the climb fades early, extend it.',
    'This setup gives the rocket very little powered runway.',
  ],
  'burn-long': [
    'Burn duration is long. That can smooth the ascent, but it may soften the initial punch.',
    'You are spreading thrust over a long window. Useful for control, not always for raw climb speed.',
    'A long burn can keep the rocket climbing steadily, but only if thrust remains meaningful.',
    'This is a gentle-burn profile. If liftoff feels lazy, shorten the burn or add thrust.',
    'You are optimizing for sustained push. Make sure the rocket can still clear dense air efficiently.',
  ],
  'drag-high': [
    'Drag coefficient is high. The atmosphere will punish speed much harder with this shape.',
    'This rocket is aerodynamically expensive. Lower drag if you want an easier ascent.',
    'High drag means more energy lost to air resistance, especially near the ground.',
    'If the rocket feels slow despite decent thrust, drag may be the main culprit.',
    'This setup is fighting the air more than it needs to.',
  ],
  'crosswind-high': [
    'Crosswind is strong. Expect lateral drift unless the rest of the setup is very forgiving.',
    'The wind is pushing hard sideways here. Watch for a crooked ascent.',
    'This is a difficult weather launch. A straighter pad and stronger climb will help.',
    'High crosswind can turn a decent rocket into a messy trajectory fast.',
    'That crosswind setting is harsh. Great for challenge, not for clean baseline testing.',
  ],
  'windshear-high': [
    'Wind shear is strong. Conditions may change with altitude even if the pad feels manageable.',
    'This launch is not just windy, it is variable with height. Expect a less predictable climb.',
    'High shear can bend the trajectory mid-flight. Small guidance weaknesses become visible quickly.',
    'You have a dynamic atmosphere here. If the path twists across layers, shear is a big reason.',
    'Strong wind shear means the rocket may behave differently at each altitude band.',
  ],
  'thermal-high': [
    'Thermal load is high. Fast climbs will be punished more as heating builds.',
    'This setup is vulnerable to heat penalties. Brutal acceleration may backfire.',
    'You are asking the rocket to survive a hot ascent. Smooth climbs matter more here.',
    'High thermal stress makes aggressive launches more expensive.',
    'If you want this profile to work, avoid combining huge thrust with huge drag.',
  ],
  'dense-atmosphere': [
    'The atmosphere is thick. Expect more drag, more heating, and a harder climb.',
    'Dense air makes ascent less forgiving. The rocket needs strong early performance.',
    'You are launching through heavy air. Efficient aerodynamics matter more here.',
    'A thick atmosphere drains speed quickly. Shallow or draggy builds suffer most.',
    'This sky is not easy mode. The atmosphere is doing real work against you.',
  ],
  'thin-atmosphere': [
    'The atmosphere is thin. Drag is lower, so efficient high-speed climbs become easier.',
    'Thin air helps the rocket keep its speed. This can favor ambitious orbit or escape attempts.',
    'You have a forgiving atmosphere here. The rocket will lose less energy to drag.',
    'This profile is kinder to fast ascents. Use that advantage if you want to push harder.',
    'A thinner atmosphere means less resistance, though you still need enough thrust and good geometry.',
  ],
  'gravity-high': [
    'Gravity is strong here. The rocket needs efficient acceleration from the start.',
    'This planet pulls hard. Weak thrust or a wasteful angle will get punished quickly.',
    'High gravity shrinks your margin for error. Efficiency matters on every slider.',
    'You are launching from a deep gravity well. Orbit will be tougher than usual.',
    'Strong gravity means altitude is expensive. Do not waste the powered phase.',
  ],
  'gravity-low': [
    'Gravity is light here. The rocket has room to be more ambitious than usual.',
    'A low-gravity world gives you breathing room. This is a good place to test bold trajectories.',
    'This planet is helping you out. You can afford a less brutal launch profile here.',
    'Lower gravity makes ascent forgiving. Great for learning which other parameters matter most.',
    'You have a shallow gravity well. If the launch still struggles, another slider is the bottleneck.',
  ],
  'pad-tilt-high': [
    'Pad tilt is large. You are baking lateral bias into the launch from frame one.',
    'A tilted pad can help shape a path, but this amount may destabilize the climb.',
    'You are starting with a noticeable lean. Great for challenge, risky for consistency.',
    'If the rocket veers immediately, the pad tilt is part of the story.',
    'This is no longer a neutral launch platform. Tilt is now a major factor.',
  ],
  'stage-separation-on': [
    'Stage separation is enabled. That gives you a more advanced efficiency profile.',
    'You have staging on. Good choice if the rest of the build is coherent.',
    'This is smarter mass management. Useful for orbit or escape attempts.',
    'Stage separation can help a lot once the basic flight profile is solid.',
    'You are using one of the stronger advanced tools in the simulator now.',
  ],
  launching: [
    'Powered ascent is underway. Watch whether this climb turns into useful coasting energy.',
    'The rocket is under thrust now. Let the run breathe before making new changes.',
    'This is the part where launch quality is decided. Save judgment until coasting begins.',
    'Powered flight is active. What matters next is whether this energy is shaped efficiently.',
    'The engine is doing its job now. The real verdict comes from the trajectory it creates.',
  ],
  'launching-risk': [
    'This ascent looks stressed. Weather, tilt, or thermal penalties may be stacking against you.',
    'The live flight profile is risky. If it fails, check wind and pad geometry before everything else.',
    'The rocket is surviving, but not comfortably. Watch for drift or wasted speed.',
    'This launch has warning signs. A calmer setup could improve the next attempt immediately.',
    'You are forcing a difficult powered ascent. It may still work, but the margin is thin.',
  ],
  coasting: [
    'The rocket is coasting now. Momentum and trajectory quality matter more than raw thrust.',
    'Coasting phase is active. If the path looks weak, the fix is usually earlier in the launch.',
    'The engine has handed off to physics. Now the arc either carries or collapses.',
    'This is the truth-telling phase. Strong launches still look healthy here.',
    'Watch the arc in coasting. It reveals whether the powered phase was actually good.',
  ],
  crashed: [
    'That run ended in a crash. Start by checking thrust, angle, and pad tilt.',
    'Impact means the rocket never converted enough energy into a sustainable climb.',
    'This flight failed early. A cleaner angle or stronger engine is the simplest next move.',
    'The rocket came back down hard. Fix one major weakness instead of tweaking everything.',
    'If the ascent drifted before impact, weather and tilt are strong suspects.',
  ],
  suborbital: [
    'Suborbital means you climbed, but not with enough sideways speed to stay up.',
    'You reached altitude, but the path did not close into orbit.',
    'This is close enough to learn from. Usually the missing ingredient is horizontal velocity.',
    'A suborbital result often means the rocket climbed well but shaped the arc poorly.',
    'You have altitude, but not orbital commitment. Tune for lateral speed next.',
  ],
  orbiting: [
    'Stable orbit achieved. This is a strong baseline profile worth remembering.',
    'You made orbit. Now experiment around the edges and see what breaks it.',
    'That launch worked. Change only one variable at a time if you want to optimize it.',
    'Orbit is locked in. Altitude and horizontal speed are finally working together.',
    'This is the kind of profile you can use as a reference build for harder runs.',
  ],
  escape: [
    'Escape velocity reached. The rocket has enough energy to leave the planet entirely.',
    'This run is no longer trying to orbit, it is departing the planet.',
    'You escaped the gravity well. Great if that was the goal, excessive if you wanted orbit.',
    'This profile has more than enough energy to keep going.',
    'You have crossed from orbital ambition into full departure. That is a valid success state.',
  ],
};

export const deriveHintScenario = (params: RocketParams, state: RocketState): HintScenario => {
  if (state.phase === 'outcome') {
    if (state.outcome === 'crashed') return 'crashed';
    if (state.outcome === 'suborbital') return 'suborbital';
    if (state.outcome === 'orbiting') return 'orbiting';
    if (state.outcome === 'escape') return 'escape';
  }

  if (state.phase === 'launching') {
    const riskyLaunch =
      Math.abs(params.crosswind) >= 20 ||
      params.windShear >= 0.55 ||
      params.thermalLoad >= 0.5 ||
      Math.abs(params.padTilt) >= 5;
    return riskyLaunch ? 'launching-risk' : 'launching';
  }
  if (state.phase === 'coasting') return 'coasting';

  if (Math.abs(params.padTilt) >= 5) return 'pad-tilt-high';
  if (Math.abs(params.crosswind) >= 25) return 'crosswind-high';
  if (params.windShear >= 0.65) return 'windshear-high';
  if (params.thermalLoad >= 0.55) return 'thermal-high';
  if (params.gravity >= 15) return 'gravity-high';
  if (params.gravity <= 5) return 'gravity-low';
  if (params.atmosphericDensity >= 0.75 || params.atmosphericPressure >= 1.15) return 'dense-atmosphere';
  if (params.atmosphericDensity <= 0.2 && params.atmosphericPressure <= 0.85) return 'thin-atmosphere';
  if (params.launchAngle <= 3) return 'angle-low';
  if (params.launchAngle >= 24) return 'angle-high';
  if (params.thrustForce <= 22) return 'thrust-low';
  if (params.thrustForce >= 75) return 'thrust-high';
  if (params.fuelMass <= 40) return 'fuel-low';
  if (params.fuelMass >= 140) return 'fuel-heavy';
  if (params.burnDuration <= 6) return 'burn-short';
  if (params.burnDuration >= 22) return 'burn-long';
  if (params.dragCoefficient >= 0.65) return 'drag-high';
  if (params.stageSeparation) return 'stage-separation-on';
  return 'balanced-prelaunch';
};

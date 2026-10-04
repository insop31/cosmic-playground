import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { Html } from '@/stage/World';
import type { CelestialBody } from './types';
import { conicPoints } from '@/physics/orbits';
import { MAX_FRAME_DELTA, reportSpacetimeSpeed } from '@/physics/schedule';
import type { SimSnapshot } from '@/physics/simulation';
import { SimulationClient } from '@/physics/simulationClient';
import type { SimMessage } from '@/physics/simulationProtocol';
import { missionTracker } from '@/app/missionTracker';
import { logLabEvent } from '@/stores/eventStore';
import { useProgressStore } from '@/stores/progressStore';
import { useSimStore } from '@/stores/simStore';
import { useSpacetimeStore } from '@/stores/spacetimeStore';
import { BodyRenderer, MAX_TRAIL_POINTS, type MeshEntry } from './BodyVisuals';
import ImpactCameraDirector, { type ImpactPopupState } from './ImpactCameraDirector';
import { clearLiveWorld, liveOrbit, liveWorld, publishSnapshot, simulationControls } from './liveWorld';
import { surfaceHeight, updateWells } from './wellField';

interface TrailBuffer {
  data: Float32Array;
  head: number;
  len: number;
  /** Simulated time of the newest point. */
  lastTime: number;
}

export interface PhysicsSimulatorProps {
  bodies: CelestialBody[];
  /** Changing this restarts the simulation from `bodies` and clears rewind history. */
  epoch: number;
  /** Signed simulation speed; 0 while paused or hidden. */
  timeScale: number;
  realisticMode: boolean;
  /** Fractional expansion rate per simulated second; 0 disables expansion. */
  expansionRate: number;
  /** How many recent positions each trail shows (graphics quality). */
  trailPoints: number;
  controlsRef: RefObject<OrbitControlsImpl | null>;
}

const CONIC_SEGMENTS = 160;
/** Trails gain a point at most this often in simulated time, so warp shows longer arcs. */
const TRAIL_SPACING = 1 / 30;
/** The HUD (timeline, conservation, objectives) refreshes at most this often. */
const HUD_INTERVAL_MS = 200;

const EMPTY_META = new Map<string, CelestialBody>();

/**
 * Renders the Spacetime simulation, which runs in a Web Worker (or in-process where
 * workers are unavailable). Each frame asks it to advance by the frame's time × the
 * speed; each state it sends back moves the meshes, trails and gravity wells, and
 * feeds the HUD, the inspector and the objectives.
 */
const PhysicsSimulator = ({ bodies, epoch, timeScale, realisticMode, expansionRate, trailPoints, controlsRef }: PhysicsSimulatorProps) => {
  const clientRef = useRef<SimulationClient | null>(null);
  const meshEntriesRef = useRef(new Map<string, MeshEntry>());
  const trailsRef = useRef(new Map<string, TrailBuffer>());
  const epochRef = useRef<number | null>(null);
  // Ids the simulation has been told about this run, ids it removed itself (collisions,
  // rewinds) and the ids React held last time, to work out adds and removals.
  const knownIdsRef = useRef(new Set<string>());
  const coreRemovedRef = useRef(new Set<string>());
  const prevPropIdsRef = useRef(new Set<string>());
  const metaRef = useRef<ReadonlyMap<string, CelestialBody>>(EMPTY_META);
  const configRef = useRef({ realisticMode, expansionRate });
  configRef.current = { realisticMode, expansionRate };
  const trailPointsRef = useRef(trailPoints);
  trailPointsRef.current = Math.min(trailPoints, MAX_TRAIL_POINTS);
  const lastHudRef = useRef(0);
  const hudTimerRef = useRef<number | null>(null);
  const lastStateRef = useRef<{ simTime: number; at: number } | null>(null);

  // ── Collision reports (one at a time; the newest waits behind it) ──
  const [activeImpact, setActiveImpact] = useState<ImpactPopupState | null>(null);
  const [hasPendingImpact, setHasPendingImpact] = useState(false);
  const pendingImpactRef = useRef<ImpactPopupState | null>(null);
  const activeImpactRef = useRef<ImpactPopupState | null>(null);
  const impactSeqRef = useRef(0);

  const queueImpactPopup = useCallback((item: ImpactPopupState) => {
    if (!activeImpactRef.current) {
      activeImpactRef.current = item;
      setActiveImpact(item);
    } else {
      pendingImpactRef.current = item;
      setHasPendingImpact(true);
    }
  }, []);

  const dismissImpact = useCallback(() => {
    const next = pendingImpactRef.current;
    pendingImpactRef.current = null;
    activeImpactRef.current = next;
    setHasPendingImpact(false);
    setActiveImpact(next);
  }, []);

  const clearImpacts = useCallback(() => {
    pendingImpactRef.current = null;
    activeImpactRef.current = null;
    setActiveImpact(null);
    setHasPendingImpact(false);
  }, []);

  // ── Selected body: its predicted orbit (dashed) ──
  const conicLine = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((CONIC_SEGMENTS + 1) * 3), 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineDashedMaterial({ color: '#4ade80', dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.85, depthWrite: false });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = 2;
    return line;
  }, []);
  useEffect(() => () => {
    conicLine.geometry.dispose();
    (conicLine.material as THREE.Material).dispose();
  }, [conicLine]);

  const updateConic = () => {
    const id = useSpacetimeStore.getState().selectedBodyId;
    const orbit = id ? liveOrbit(id) : null;
    const parent = orbit ? liveWorld.find(orbit.parentId) : undefined;
    if (!orbit || !parent) {
      conicLine.geometry.setDrawRange(0, 0);
      return;
    }
    const points = conicPoints(orbit.elements, parent.position.x, parent.position.z, CONIC_SEGMENTS);
    const attr = conicLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    points.forEach(([x, z], k) => {
      arr[k * 3] = x;
      arr[k * 3 + 1] = surfaceHeight(x, z) + 0.1;
      arr[k * 3 + 2] = z;
    });
    attr.needsUpdate = true;
    conicLine.geometry.setDrawRange(0, points.length);
    conicLine.computeLineDistances();
    (conicLine.material as THREE.LineDashedMaterial).color.set(orbit.bound ? '#4ade80' : '#f5b83d');
  };

  // ── Trails: a point per TRAIL_SPACING of simulated time, resting on the sheet ──
  const appendTrail = (id: string, x: number, z: number, simTime: number) => {
    let trail = trailsRef.current.get(id);
    if (!trail) {
      trail = { data: new Float32Array(MAX_TRAIL_POINTS * 3), head: 0, len: 0, lastTime: -Infinity };
      trailsRef.current.set(id, trail);
    }
    if (simTime - trail.lastTime < TRAIL_SPACING) return;
    trail.lastTime = simTime;
    const idx = trail.head * 3;
    trail.data[idx] = x;
    trail.data[idx + 1] = surfaceHeight(x, z) + 0.06;
    trail.data[idx + 2] = z;
    trail.head = (trail.head + 1) % MAX_TRAIL_POINTS;
    trail.len = Math.min(trail.len + 1, MAX_TRAIL_POINTS);
  };

  const clearTrails = () => {
    trailsRef.current.clear();
    for (const entry of meshEntriesRef.current.values()) entry.trailLine.geometry.setDrawRange(0, 0);
  };

  /** Move meshes and trails to the live state; bodies missing from it are hidden. */
  const syncMeshes = () => {
    const present = new Set<string>();
    for (const body of liveWorld.bodies) {
      present.add(body.id);
      const entry = meshEntriesRef.current.get(body.id);
      if (!entry) continue;
      const { x, z } = body.position;
      entry.groupRef.current?.position.set(x, surfaceHeight(x, z) + body.radius * 0.85, z);
      entry.meshRef.current?.scale.setScalar(body.radius);
      if (entry.glowRef.current) {
        entry.glowRef.current.scale.setScalar(body.radius * 1.8);
        const mat = entry.glowRef.current.material as THREE.MeshBasicMaterial;
        if (mat) mat.opacity = body.motion === 'escaping' ? 0.18 : 0.08;
      }
      const trail = trailsRef.current.get(body.id);
      const arr = entry.trailAttr.array as Float32Array;
      const shown = trail ? Math.min(trail.len, trailPointsRef.current) : 0;
      for (let k = 0; k < shown; k++) {
        const src = ((trail!.head - shown + k + MAX_TRAIL_POINTS) % MAX_TRAIL_POINTS) * 3;
        arr[k * 3] = trail!.data[src];
        arr[k * 3 + 1] = trail!.data[src + 1];
        arr[k * 3 + 2] = trail!.data[src + 2];
      }
      entry.trailAttr.needsUpdate = true;
      entry.trailLine.geometry.setDrawRange(0, shown);
    }
    for (const [id, entry] of meshEntriesRef.current) {
      const visible = present.has(id);
      if (entry.groupRef.current) entry.groupRef.current.visible = visible;
      entry.trailLine.visible = visible;
    }
  };

  /** HUD refresh: timeline, conservation and the objectives that judge the simulation. */
  const flushHud = () => {
    hudTimerRef.current = null;
    lastHudRef.current = performance.now();
    const snapshot = liveWorld.snapshot;
    if (!snapshot) return;
    useSimStore.getState().setSnapshot(snapshot);
    const { unlock } = useProgressStore.getState();
    const typeOf = (id: string) => metaRef.current.get(id)?.type;
    missionTracker.update(snapshot, typeOf).forEach(unlock);
  };

  const scheduleHud = () => {
    if (hudTimerRef.current !== null) return;
    const wait = Math.max(0, HUD_INTERVAL_MS - (performance.now() - lastHudRef.current));
    hudTimerRef.current = window.setTimeout(flushHud, wait);
  };

  const handleMessage = (message: SimMessage) => {
    if (message.type !== 'state' || message.epoch !== epochRef.current) return;
    const { result, snapshot } = message;
    const store = useSpacetimeStore.getState();

    for (const impact of result.impacts) {
      queueImpactPopup({
        id: `impact-${impactSeqRef.current++}`,
        title: impact.title,
        detail: impact.detail,
        stats: impact.kind === 'tidal'
          ? 'Momentum kept: 100% · The energy for the stream came from the black hole’s tides.'
          : `Momentum kept: 100% · Impact energy turned to heat: ${Math.round(impact.kineticEnergyLost * 100)}%`,
        position: [impact.position[0], surfaceHeight(impact.position[0], impact.position[2]) + 2.5, impact.position[2]],
      });
      logLabEvent('spacetime', impact.title, impact.kind === 'bounce' ? 'warn' : 'danger');
    }
    if (result.impacts.length > 0) {
      const { unlock } = useProgressStore.getState();
      missionTracker.noteImpacts(result.impacts).forEach(unlock);
    }
    for (const body of result.spawned) {
      knownIdsRef.current.add(body.id);
      store.addSimulatedBody(body);
    }
    for (const id of result.removed) {
      coreRemovedRef.current.add(id);
      trailsRef.current.delete(id);
      store.dropSimulatedBody(id);
    }
    for (const body of result.restored) {
      coreRemovedRef.current.delete(body.id);
      knownIdsRef.current.add(body.id);
      store.addSimulatedBody(body);
    }
    for (const update of result.updated) {
      const current = metaRef.current.get(update.id);
      if (current && (current.mass !== update.mass || current.radius !== update.radius)) {
        store.updateBody(update.id, update.mass, update.radius);
      }
    }

    publishSnapshot(snapshot, metaRef.current);
    updateWells(liveWorld.bodies);
    if (result.direction === 1 && result.stepsTaken > 0) {
      for (const body of liveWorld.bodies) appendTrail(body.id, body.position.x, body.position.z, snapshot.simTime);
    }

    // Achieved speed, for the time controls (crowded systems can't always reach full warp).
    const now = performance.now();
    const last = lastStateRef.current;
    if (last && result.direction === 1) reportSpacetimeSpeed(snapshot.simTime - last.simTime, (now - last.at) / 1000, result.limited);
    lastStateRef.current = { simTime: snapshot.simTime, at: now };

    scheduleHud();
  };
  const handleMessageRef = useRef(handleMessage);
  handleMessageRef.current = handleMessage;

  // ── Simulation lifetime ──
  useEffect(() => {
    const client = new SimulationClient((message) => handleMessageRef.current(message));
    clientRef.current = client;
    simulationControls.current = {
      seek: (step) => {
        if (epochRef.current !== null) client.send({ type: 'seek', epoch: epochRef.current, step });
      },
      setPinned: (id, pinned) => {
        if (epochRef.current !== null) client.send({ type: 'pin', epoch: epochRef.current, id, pinned });
      },
    };
    return () => {
      client.dispose();
      clientRef.current = null;
      epochRef.current = null;
      simulationControls.current = null;
      clearLiveWorld();
      if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current);
    };
  }, []);

  // ── Keep the simulation's body list in step with the store ──
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    const propIds = new Set(bodies.map((b) => b.id));
    metaRef.current = new Map(bodies.map((b) => [b.id, b]));

    if (epochRef.current !== epoch) {
      // Reset, template, saved system or first run: start a fresh simulation.
      epochRef.current = epoch;
      knownIdsRef.current = new Set(propIds);
      coreRemovedRef.current = new Set();
      prevPropIdsRef.current = propIds;
      lastStateRef.current = null;
      clearTrails();
      clearImpacts();
      useSimStore.getState().clear();
      client.send({
        type: 'load',
        epoch,
        bodies,
        config: { realistic: configRef.current.realisticMode, expansionRate: configRef.current.expansionRate },
      });
      return;
    }

    for (const body of bodies) {
      if (knownIdsRef.current.has(body.id)) continue;
      knownIdsRef.current.add(body.id);
      client.send({ type: 'add', epoch, body });
    }
    for (const id of prevPropIdsRef.current) {
      if (propIds.has(id) || coreRemovedRef.current.has(id)) continue; // the simulation removed it itself
      client.send({ type: 'remove', epoch, id });
      trailsRef.current.delete(id);
    }
    prevPropIdsRef.current = propIds;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodies, epoch]);

  useEffect(() => {
    if (epochRef.current === null) return;
    clientRef.current?.send({ type: 'config', epoch: epochRef.current, config: { realistic: realisticMode } });
  }, [realisticMode]);

  useEffect(() => {
    if (epochRef.current === null) return;
    clientRef.current?.send({ type: 'config', epoch: epochRef.current, config: { expansionRate } });
  }, [expansionRate]);

  // ── Frame loop: ask the simulation to advance (or rewind) by this frame's time ──
  useFrame((_, delta) => {
    const client = clientRef.current;
    if (client && epochRef.current !== null && timeScale !== 0) {
      client.tick(epochRef.current, Math.min(delta, MAX_FRAME_DELTA) * timeScale);
    }
    syncMeshes();
    updateConic();
  });

  return (
    <>
      <primitive object={conicLine} />
      <ImpactCameraDirector activeImpact={activeImpact} controlsRef={controlsRef} />
      {activeImpact && (
        <Html
          key={activeImpact.id}
          position={activeImpact.position}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div
            className="scene-label scene-label-accent w-[340px] border-l-primary px-4 py-3.5"
            style={{ pointerEvents: 'auto' }}
            role="status"
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <span className="scene-tag mb-1 bg-primary/15 text-primary">Collision</span>
                <div className="font-display text-[15px] font-semibold uppercase tracking-[0.08em] text-foreground">
                  {activeImpact.title}
                </div>
              </div>
              <button
                onClick={dismissImpact}
                className="hud-focus mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-hud-dim transition-colors hover:bg-white/10 hover:text-foreground"
                title="Dismiss"
                aria-label="Dismiss collision report"
              >
                <svg width="12" height="12" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.50001L3.21846 10.9684C2.99391 11.193 2.99391 11.5571 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31319L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.5571 12.0062 11.193 11.7816 10.9684L8.31322 7.50001L11.7816 4.03157Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <p className="text-[13px] leading-relaxed text-foreground/85">{activeImpact.detail}</p>
            {activeImpact.stats && (
              <p className="hud-num mt-2 text-[11.5px] leading-snug text-hud-dim">{activeImpact.stats}</p>
            )}
            {hasPendingImpact && (
              <p className="mt-2.5 border-t border-white/[0.07] pt-2 font-mono text-[11px] text-primary/80">
                +1 more collision — dismiss to view
              </p>
            )}
          </div>
        </Html>
      )}
      {bodies.map((body) => (
        <BodyRenderer key={body.id} body={body} meshEntriesRef={meshEntriesRef} />
      ))}
    </>
  );
};

export default PhysicsSimulator;


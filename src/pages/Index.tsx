import { useState, useCallback, useRef } from 'react';
import SpaceScene, { CelestialBody } from '../components/space/SpaceScene';
import TimeControls from '../components/ui/TimeControls';
import ObjectLibrary from '../components/ui/ObjectLibrary';
import { Atom } from 'lucide-react';

let nextId = 1;

const Index = () => {
  const [bodies, setBodies] = useState<CelestialBody[]>([
    { id: 'sun', type: 'star', position: [0, 0, 0], mass: 10, radius: 1.5, color: '#ffcc00', velocity: [0, 0, 0] },
    { id: 'planet1', type: 'planet', position: [8, 0, 0], mass: 2, radius: 0.7, color: '#4488ff', velocity: [0, 0, 1.1] },
    { id: 'planet2', type: 'planet', position: [-5, 0, 6], mass: 1.5, radius: 0.5, color: '#ff6644', velocity: [0.9, 0, 0.3] },
  ]);
  const [timeScale, setTimeScale] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);

  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;

  const handleUpdateBody = useCallback((id: string, pos: [number, number, number], vel: [number, number, number]) => {
    setBodies((prev) =>
      prev.map((b) => (b.id === id ? { ...b, position: pos, velocity: vel } : b))
    );
  }, []);

  const handleAddObject = useCallback((obj: Omit<CelestialBody, 'id'>) => {
    const id = `obj_${nextId++}`;
    setBodies((prev) => [...prev, { ...obj, id }]);
  }, []);

  const handleRemoveAll = useCallback(() => {
    setBodies([]);
  }, []);

  const handleReset = useCallback(() => {
    setBodies([
      { id: 'sun', type: 'star', position: [0, 0, 0], mass: 10, radius: 1.5, color: '#ffcc00', velocity: [0, 0, 0] },
      { id: 'planet1', type: 'planet', position: [8, 0, 0], mass: 2, radius: 0.7, color: '#4488ff', velocity: [0, 0, 1.1] },
    ]);
    setTimeScale(1);
    setIsPlaying(true);
  }, []);

  const effectiveTimeScale = isPlaying ? timeScale : 0;

  return (
    <div className="w-full h-screen relative overflow-hidden bg-background">
      {/* 3D Canvas */}
      <div className="absolute inset-0">
        <SpaceScene
          bodies={bodies}
          timeScale={effectiveTimeScale}
          onUpdateBody={handleUpdateBody}
        />
      </div>

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-10 p-4 flex items-center justify-between pointer-events-none">
        <div className="glass-panel px-4 py-2.5 flex items-center gap-3 pointer-events-auto">
          <Atom size={20} className="text-primary animate-pulse-glow" />
          <div>
            <h1 className="text-sm font-bold tracking-wide text-foreground">
              SPACE–TIME LAB
            </h1>
            <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">
              Interactive Physics Sandbox
            </p>
          </div>
        </div>

        <div className="glass-panel px-3 py-2 pointer-events-auto">
          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="text-muted-foreground">
              Bodies: <span className="text-primary">{bodies.length}</span>
            </div>
            <div className="text-muted-foreground">
              Speed: <span className="text-primary">{timeScale}x</span>
            </div>
          </div>
        </div>
      </div>

      {/* Left Panel */}
      <div className="absolute left-4 top-20 z-10 pointer-events-auto">
        <ObjectLibrary
          onAddObject={handleAddObject}
          bodies={bodies}
          onRemoveAll={handleRemoveAll}
        />
      </div>

      {/* Bottom Center - Time Controls */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-auto">
        <TimeControls
          timeScale={timeScale}
          isPlaying={isPlaying}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onSpeedChange={setTimeScale}
          onReset={handleReset}
        />
      </div>

      {/* Bottom Right - Hint */}
      <div className="absolute bottom-6 right-4 z-10">
        <p className="text-[10px] font-mono text-muted-foreground/50">
          Drag to orbit · Scroll to zoom · Add objects to warp spacetime
        </p>
      </div>
    </div>
  );
};

export default Index;

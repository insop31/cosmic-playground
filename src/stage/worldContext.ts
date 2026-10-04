import { createContext, useContext } from 'react';

/** Whether the surrounding <World> is the one on screen (see World.tsx). */
export const WorldActiveContext = createContext(true);

export const useWorldActive = () => useContext(WorldActiveContext);

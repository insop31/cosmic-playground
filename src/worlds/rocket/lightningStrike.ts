// Shared lightning strike state: mutated by LightningEffect, read by the shake group and HUD.
export interface LightningStrikeState {
  version: number;
  /** 0–1, decays in WeatherShakeGroup for a hard jolt */
  impulse: number;
}

export function createLightningStrikeState(): LightningStrikeState {
  return { version: 0, impulse: 0 };
}

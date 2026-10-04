/**
 * Every streamed 3D asset, grouped by the lab that needs it.
 *
 * Files live in public/ (optimized by `npm run assets:optimize`) and are
 * referenced here by URL so loaders, preloading and the boot progress bar
 * share one list. Add the licence/credit for each third-party file to
 * CREDITS.md in the same commit that adds it here.
 */
export type AssetKind = 'model' | 'texture' | 'hdri';

export interface AssetEntry {
  url: string;
  kind: AssetKind;
  /** Approximate transfer size, used for the boot progress label. */
  bytes: number;
}

export const ASSETS = {
  spacetime: {} as Record<string, AssetEntry>,
  rocket: {} as Record<string, AssetEntry>,
} satisfies Record<'spacetime' | 'rocket', Record<string, AssetEntry>>;

export type AssetGroup = keyof typeof ASSETS;

export const groupBytes = (group: AssetGroup) =>
  Object.values(ASSETS[group]).reduce((total, entry) => total + entry.bytes, 0);

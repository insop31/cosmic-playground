// Share saved systems and rocket presets as files, e.g. a teacher handing a setup to a
// class. Writing a file needs no validation library; reading one (exportImport.ts) does,
// so that part loads only when a file is imported.
import type { SavedRocketPreset, SavedSpacetimeScenario } from './scenarioStorage';

export const EXPORT_FORMAT = 'cosmic-playground';
export const EXPORT_VERSION = 1;

export function buildExportFile(scenarios: SavedSpacetimeScenario[], presets: SavedRocketPreset[]): string {
  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    spacetimeScenarios: scenarios.map(({ name, bodies, placementVelocityScale, realisticMode }) => ({ name, bodies, placementVelocityScale, realisticMode })),
    rocketPresets: presets.map(({ name, params }) => ({ name, params })),
  }, null, 2);
}

/** Ask the browser to save `text` as a file. */
export function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

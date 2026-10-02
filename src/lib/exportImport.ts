// Share saved systems and rocket presets as files, e.g. a teacher handing a setup to a
// class. Imported files are validated before anything is stored.
import { z } from 'zod';
import { DEFAULT_PARAMS, normalizeRocketParams } from '../components/rocket/rocketTypes';
import type { SavedRocketPreset, SavedSpacetimeScenario } from './scenarioStorage';

export const EXPORT_FORMAT = 'cosmic-playground';
export const EXPORT_VERSION = 1;

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

const bodySchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(80).optional(),
  type: z.string().min(1).max(30),
  bodyClass: z.enum(['rocky', 'gas', 'ice', 'star', 'asteroid', 'blackhole', 'neutron', 'comet']).optional(),
  position: vec3,
  mass: z.number().positive().finite(),
  radius: z.number().positive().max(50),
  physicalRadius: z.number().positive().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/),
  atmosphere: z.boolean().optional(),
  eventHorizonRadius: z.number().positive().optional(),
  velocity: vec3.optional(),
  pinned: z.boolean().optional(),
});

const scenarioSchema = z.object({
  name: z.string().min(1).max(60),
  bodies: z.array(bodySchema).max(180),
  placementVelocityScale: z.number().min(0.2).max(3),
  realisticMode: z.boolean(),
});

const rocketParamsSchema = z.object(
  Object.fromEntries(
    Object.entries(DEFAULT_PARAMS).map(([key, value]) => [key, typeof value === 'boolean' ? z.boolean().optional() : z.number().finite().optional()]),
  ),
);

const presetSchema = z.object({
  name: z.string().min(1).max(60),
  params: rocketParamsSchema,
});

const fileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.number().int().min(1).max(EXPORT_VERSION),
  spacetimeScenarios: z.array(scenarioSchema).max(50).default([]),
  rocketPresets: z.array(presetSchema).max(50).default([]),
});

export type ImportedScenario = z.infer<typeof scenarioSchema>;

export interface ImportedFile {
  spacetimeScenarios: Omit<SavedSpacetimeScenario, 'id' | 'createdAt' | 'updatedAt'>[];
  rocketPresets: Omit<SavedRocketPreset, 'id' | 'createdAt' | 'updatedAt'>[];
}

export function buildExportFile(scenarios: SavedSpacetimeScenario[], presets: SavedRocketPreset[]): string {
  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    spacetimeScenarios: scenarios.map(({ name, bodies, placementVelocityScale, realisticMode }) => ({ name, bodies, placementVelocityScale, realisticMode })),
    rocketPresets: presets.map(({ name, params }) => ({ name, params })),
  }, null, 2);
}

/** Parse and validate an exported file; throws an Error with a readable message if invalid. */
export function parseImportFile(text: string): ImportedFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const result = fileSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    if (issue?.path[0] === 'format') throw new Error('This is not a Cosmic Playground export file.');
    throw new Error(`The file has a problem at ${issue?.path.join('.') || 'the top level'}: ${issue?.message ?? 'invalid data'}.`);
  }
  return {
    spacetimeScenarios: result.data.spacetimeScenarios.map((scenario) => ({
      ...scenario,
      bodies: scenario.bodies.map((body) => ({ ...body })),
    })) as ImportedFile['spacetimeScenarios'],
    rocketPresets: result.data.rocketPresets.map((preset) => ({ name: preset.name, params: normalizeRocketParams(preset.params) })),
  };
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

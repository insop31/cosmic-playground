import { buildExportFile, downloadTextFile } from '@/lib/exportFile';
import { useRocketStore } from '@/stores/rocketStore';
import { useSpacetimeStore } from '@/stores/spacetimeStore';

/** Download every saved system and rocket preset in this browser as one file. */
export const exportSavedWork = () => {
  const { savedScenarios } = useSpacetimeStore.getState();
  const { savedPresets } = useRocketStore.getState();
  downloadTextFile('cosmic-playground-export.json', buildExportFile(savedScenarios, savedPresets));
};

/**
 * Validate a shared file and add what it holds to the saved lists. The validator
 * loads only when a file is imported. Returns a message for the student.
 */
export const importSavedWork = async (text: string) => {
  try {
    const { parseImportFile } = await import('@/lib/exportImport');
    const imported = parseImportFile(text);
    useSpacetimeStore.getState().importScenarios(imported.spacetimeScenarios);
    useRocketStore.getState().importPresets(imported.rocketPresets);
    const systems = imported.spacetimeScenarios.length;
    const presets = imported.rocketPresets.length;
    return `Imported ${systems} system${systems === 1 ? '' : 's'} and ${presets} rocket preset${presets === 1 ? '' : 's'}.`;
  } catch (error) {
    return error instanceof Error ? error.message : 'Could not read that file.';
  }
};

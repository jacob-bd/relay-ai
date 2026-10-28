import * as p from '@clack/prompts';
import { modelIdError } from './registry/provider-models.js';
import { checkVertexModelAccess } from './registry/vertex-model-check.js';
import {
  addVertexModelEntry,
  removeVertexModelEntries,
  vertexModelDisplayName,
} from './registry/vertex-anthropic.js';
import { DEFAULT_VERTEX_MODELS, loadVertexModelEntries, resetVertexModelEntries } from './vertex-env.js';

export async function runVertexModelAddFlow(): Promise<number> {
  const current = loadVertexModelEntries();
  const modelId = await p.text({
    message: 'Vertex model ID',
    placeholder: 'e.g. claude-haiku-5-5',
    validate: value => modelIdError(value) ?? (current.some(m => m.id === value?.trim()) ? 'Already in your list.' : undefined),
  });
  if (p.isCancel(modelId)) return 0;
  const id = String(modelId).trim();
  const displayName = await p.text({
    message: 'Display name',
    initialValue: vertexModelDisplayName(id),
    validate: value => !value?.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value)
      ? 'Use 1–200 characters without control characters.' : undefined,
  });
  if (p.isCancel(displayName)) return 0;

  const spinner = p.spinner();
  spinner.start(`Checking that your Vertex project can use ${id}…`);
  const access = await checkVertexModelAccess(id);
  spinner.stop(access.ok ? 'Model is available' : 'Model check failed');
  if (!access.ok) {
    p.log.error(access.error ?? 'Vertex rejected the test request.');
    p.log.info('Check the model ID, and that this Claude model is enabled for your project in Vertex AI Model Garden.');
    return 1;
  }

  const result = addVertexModelEntry({ id, display_name: String(displayName).trim() });
  if (!result.ok) { p.log.error(result.error ?? 'Model was not added.'); return 1; }
  p.log.success(`${String(displayName).trim()} added. It appears in launch pickers from the next launch.`);
  return 0;
}

export async function runVertexModelRemoveFlow(): Promise<number> {
  const current = loadVertexModelEntries();
  const ids = await p.multiselect({
    message: 'Remove which models? (space to select, enter to confirm)',
    options: current.map(m => ({ value: m.id, label: m.display_name, hint: m.id })),
    required: false,
  });
  if (p.isCancel(ids) || ids.length === 0) return 0;
  const result = removeVertexModelEntries(ids as string[]);
  if (!result.ok) { p.log.error(result.error ?? 'Could not remove models.'); return 1; }
  p.log.success(`Removed ${ids.length} model${ids.length === 1 ? '' : 's'}.`);
  return 0;
}

export async function runVertexModelResetFlow(): Promise<number> {
  const confirmed = await p.confirm({
    message: `Replace your list with Relay's latest ${DEFAULT_VERTEX_MODELS.length} models? Future Relay updates will keep it current.`,
    initialValue: false,
  });
  if (p.isCancel(confirmed) || !confirmed) return 0;
  resetVertexModelEntries();
  p.log.success(`Using Relay's latest list: ${DEFAULT_VERTEX_MODELS.map(m => m.display_name).join(', ')}.`);
  return 0;
}

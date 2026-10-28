import * as p from '@clack/prompts';
import { modelIdError } from './registry/provider-models.js';
import { checkVertexModelAccess, filterVertexModelsByAccess } from './registry/vertex-model-check.js';
import {
  addVertexModelEntry,
  removeVertexModelEntries,
  vertexModelDisplayName,
} from './registry/vertex-anthropic.js';
import {
  DEFAULT_VERTEX_MODELS,
  loadVertexModelEntries,
  resetVertexModelEntries,
  resolveVertexProject,
  saveVertexModelEntries,
} from './vertex-env.js';

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

/**
 * Re-test the list against the project: drop models it now refuses, and offer
 * defaults that became available (e.g. after an admin allowed them). Offered,
 * not forced, so a model the user removed on purpose does not come back.
 */
export async function runVertexModelAccessFlow(): Promise<number> {
  const current = loadVertexModelEntries();
  const extras = DEFAULT_VERTEX_MODELS.filter(d => !current.some(c => c.id === d.id));
  const spinner = p.spinner();
  spinner.start(`Checking ${current.length + extras.length} models on project ${resolveVertexProject() ?? '(not set)'}…`);
  const outcome = await filterVertexModelsByAccess([...current, ...extras]);
  spinner.stop(outcome.aborted ? 'Check failed' : 'Check complete');
  if (outcome.aborted) {
    p.log.error(outcome.abortDetail ?? 'Vertex AI rejected the request.');
    p.log.info('Nothing was changed. Check your gcloud login and that your account can use Vertex AI in this project.');
    return 1;
  }

  const removed = outcome.removed.filter(r => current.some(c => c.id === r.entry.id));
  let next = current.filter(c => !removed.some(r => r.entry.id === c.id));
  const nowAvailable = extras.filter(e => outcome.confirmedIds.includes(e.id));
  if (nowAvailable.length > 0) {
    const chosen = await p.multiselect({
      message: 'These models are now available to your project. Add them?',
      options: nowAvailable.map(m => ({ value: m.id, label: m.display_name, hint: m.id })),
      initialValues: nowAvailable.map(m => m.id),
      required: false,
    });
    if (!p.isCancel(chosen)) next = [...next, ...nowAvailable.filter(m => (chosen as string[]).includes(m.id))];
  }

  for (const r of removed) p.log.warn(`Removed ${r.entry.display_name}: ${r.reason}.`);
  const unchecked = next.filter(m => current.some(c => c.id === m.id) && !outcome.confirmedIds.includes(m.id));
  if (unchecked.length > 0) {
    p.log.info(`Couldn't confirm ${unchecked.map(m => m.display_name).join(', ')} right now (rate limit or outage) — kept in your list.`);
  }
  if (next.length === 0) {
    p.log.error('None of your models are available to this project, so the list was left unchanged.');
    return 1;
  }
  const changed = next.length !== current.length || next.some((m, i) => m.id !== current[i]?.id);
  if (!changed) {
    if (unchecked.length === 0) p.log.success(`All ${current.length} models in your list are available.`);
    return 0;
  }
  saveVertexModelEntries(next);
  const added = next.length - (current.length - removed.length);
  p.log.success(`Model list updated: ${next.length} models${added > 0 ? `, ${added} added` : ''}${removed.length ? `, ${removed.length} removed` : ''}.`);
  return 0;
}

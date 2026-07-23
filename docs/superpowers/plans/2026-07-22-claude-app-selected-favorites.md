# Claude App Selected Model Plus Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every specific `relay-ai claude-app` launch expose the selected model followed by the user's available saved favorites.

**Architecture:** Add a focused Claude Desktop catalog module that resolves a selected model plus favorites through the shared favorites resolver, then converts the ordered result into `ServerModelInfo[]`. `runClaudeAppCommand` will use this one path for direct selections, Admin UI boot selections, and the existing Favorites picker while retaining the existing server and Claude Desktop configuration lifecycle.

**Tech Stack:** TypeScript, Node.js, Vitest, existing Relay AI favorites resolver, existing Cloud Code backend, existing Anthropic-format server gateway.

## Global Constraints

- The selected model is always first.
- Deduplicate by provider id plus model id while preserving saved order.
- The final catalog contains at most `MAX_MODEL_CATALOG` entries, including the selected model.
- Providers that allow anonymous access remain valid; favorites missing a required credential are skipped and reported.
- Only `cloud-code` models use the nested Cloud Code backend because Claude App's server already handles OAuth Anthropic routes.
- Backend-routed entries must be mapped back to their original catalog positions.
- A launch with no saved favorites remains a one-model launch.
- Relay AI cannot promise which discovered model Claude Desktop initially activates.
- Do not expose every model from the selected provider.

---

## File Structure

- Create `src/claude-desktop/model-catalog.ts`: resolve selected-plus-favorites catalogs, convert resolved entries into ordered server models, and own `modelToServerModelInfo`.
- Create `tests/claude-app-model-catalog.test.ts`: focused resolver, cap, credential, ordering, and Cloud Code conversion tests.
- Modify `src/claude-app.ts`: select a starting model for every path and launch the shared resolved catalog.
- Modify `tests/claude-app.test.ts`: command-level behavior for direct, deduplicated, and no-favorites launches.
- Modify `src/claude-app.ts` help/session copy: describe selected-plus-favorites behavior accurately.
- Modify `tests/ui-api-apps.test.ts`: verify an Admin UI Claude App Favorites launch resolves the first favorite into the normal provider/model boot command.

---

### Task 1: Resolve the selected model plus favorites

**Files:**
- Create: `src/claude-desktop/model-catalog.ts`
- Create: `tests/claude-app-model-catalog.test.ts`

**Interfaces:**
- Consumes: `resolveFavorite`, `buildFavoritesList`, `MAX_MODEL_CATALOG`, `LocalProvider`, `LocalProviderModel`, and `FavoriteModel`.
- Produces: `resolveClaudeAppCatalog(...)` and `ClaudeAppCatalogResolution` for `runClaudeAppCommand` and Task 2.

- [ ] **Step 1: Write failing resolver tests**

Create providers with direct keys and assert this public contract:

```ts
const result = await resolveClaudeAppCatalog(
  selectedProvider,
  selectedModel,
  compatibleProviders,
  savedFavorites,
);

expect(result.ok).toBe(true);
if (!result.ok) throw new Error(result.error);
expect(result.entries.map(entry => `${entry.providerId}/${entry.model.id}`)).toEqual([
  'selected/selected-model',
  'favorite/favorite-model',
]);
```

Add separate assertions for:

```ts
expect(deduplicated.entries.filter(entry => entry.model.id === selectedModel.id)).toHaveLength(1);
expect(capped.entries).toHaveLength(MAX_MODEL_CATALOG);
expect(capped.capacitySkippedFavorites).toHaveLength(1);
expect(missingCredential.droppedFavorites).toContainEqual({
  providerId: 'missing-key',
  modelId: 'missing-key-model',
});
expect(anonymous.entries.some(entry => entry.providerId === 'anonymous')).toBe(true);
```

- [ ] **Step 2: Run the resolver tests and verify RED**

Run: `npx vitest run tests/claude-app-model-catalog.test.ts`

Expected: FAIL because `src/claude-desktop/model-catalog.ts` and `resolveClaudeAppCatalog` do not exist.

- [ ] **Step 3: Implement the resolver**

Create this result contract:

```ts
export type ClaudeAppCatalogResolution =
  | {
      ok: true;
      entries: ResolvedFavorite[];
      providersById: Map<string, LocalProvider>;
      droppedFavorites: FavoriteModel[];
      capacitySkippedFavorites: FavoriteModel[];
    }
  | { ok: false; error: string };
```

Implement `resolveClaudeAppCatalog` with this sequence:

```ts
export async function resolveClaudeAppCatalog(
  selectedProvider: LocalProvider,
  selectedModel: LocalProviderModel,
  compatible: LocalProvider[],
  favorites: FavoriteModel[],
  max = MAX_MODEL_CATALOG,
): Promise<ClaudeAppCatalogResolution> {
  const providersById = new Map(compatible.map(provider => [provider.id, provider]));
  const ctx: ResolveContext = {
    agent: 'codex-app',
    localProviders: compatible,
    findLocalModel: (providerId, modelId) => {
      const provider = providersById.get(providerId);
      const model = provider?.models.find(candidate => candidate.id === modelId);
      return provider && model ? { provider, model } : undefined;
    },
  };
  const starting = await resolveFavorite(
    { providerId: selectedProvider.id, modelId: selectedModel.id },
    ctx,
  );
  if (!starting) {
    return { ok: false, error: `Model ${selectedModel.id} is no longer available on ${selectedProvider.name}.` };
  }
  if (!starting.apiKey.trim()) {
    return {
      ok: false,
      error: `No credential for ${selectedProvider.name}. Run relay-ai providers auth ${selectedProvider.id}.`,
    };
  }
  const result = await buildFavoritesList(starting, favorites, ctx, max, {
    dropEmptyApiKey: true,
    trackCapacitySkipped: true,
  });
  return { ok: true, entries: result.resolved, providersById, ...result };
}
```

When spreading `result`, avoid defining `entries` twice: destructure `resolved` first and return it as `entries`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/claude-app-model-catalog.test.ts`

Expected: all resolver tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/claude-desktop/model-catalog.ts tests/claude-app-model-catalog.test.ts
git commit -m "feat(claude-app): resolve selected model with favorites"
```

---

### Task 2: Convert the resolved catalog without losing order

**Files:**
- Modify: `src/claude-desktop/model-catalog.ts`
- Modify: `tests/claude-app-model-catalog.test.ts`
- Modify: `src/claude-app.ts`
- Modify: `tests/claude-app.test.ts`

**Interfaces:**
- Consumes: Task 1's successful `entries` and `providersById`, plus `partitionAndStartCloudCodeBackend`.
- Produces: `buildClaudeAppServerCatalog(...)`, `{ serverModels, backend }`, and the moved/re-exported `modelToServerModelInfo(...)`.

- [ ] **Step 1: Write failing conversion tests**

Mock `partitionAndStartCloudCodeBackend` so it invokes the supplied conversion callback with a stable alias such as `anthropic-antigravity__gemini-test`. Assert:

```ts
const built = await buildClaudeAppServerCatalog(entries, providersById, false);
expect(built.serverModels.map(model => model.providerId)).toEqual([
  'regular-selected',
  'antigravity',
  'regular-favorite',
]);
expect(built.serverModels[1]).toMatchObject({
  modelFormat: 'anthropic',
  upstreamModelId: 'anthropic-antigravity__gemini-test',
  baseUrl: 'http://127.0.0.1:19001',
  apiKey: 'backend-token',
});
expect(built.backend).not.toBeNull();
```

Also assert a catalog with no Cloud Code entries returns `backend: null` and keeps each resolved API key on its corresponding `ServerModelInfo`.

- [ ] **Step 2: Run conversion tests and verify RED**

Run: `npx vitest run tests/claude-app-model-catalog.test.ts`

Expected: FAIL because `buildClaudeAppServerCatalog` is not exported.

- [ ] **Step 3: Implement ordered server-model conversion**

Move `modelToServerModelInfo` from `src/claude-app.ts` into the new catalog module without changing its fields. Add:

```ts
export async function buildClaudeAppServerCatalog(
  entries: ResolvedFavorite[],
  providersById: Map<string, LocalProvider>,
  trace?: boolean,
): Promise<{ serverModels: ServerModelInfo[]; backend: CloudCodeBackend | null }>;
```

Use only entries whose `modelFormat === 'cloud-code'` as backend inputs. Pass each entry's resolved `apiKey`, provider data, and provider id to `partitionAndStartCloudCodeBackend`. Convert backend entries with these overrides:

```ts
{
  modelFormat: 'anthropic',
  upstreamModelId: proxyRoute.aliasId,
  baseUrl: `http://127.0.0.1:${backend.port}`,
  completionsUrl: undefined,
  npm: undefined,
  apiBaseUrl: undefined,
  apiKey: backend.token,
  authType: undefined,
  oauthAccountId: undefined,
  headers: undefined,
}
```

Convert regular entries with a cloned provider whose `apiKey` is the resolved entry key. Store every converted model in a map keyed by `${providerId}::${model.id}`, then rebuild `serverModels` by mapping the original `entries`. Throw a clear internal error if an entry's provider or converted model is missing.

Re-export `modelToServerModelInfo` from `src/claude-app.ts` so the existing helper tests remain source-compatible.

- [ ] **Step 4: Run conversion and existing helper tests**

Run: `npx vitest run tests/claude-app-model-catalog.test.ts tests/claude-app.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/claude-desktop/model-catalog.ts src/claude-app.ts tests/claude-app-model-catalog.test.ts tests/claude-app.test.ts
git commit -m "feat(claude-app): build ordered multi-provider catalog"
```

---

### Task 3: Wire every Claude App launch path to the shared catalog

**Files:**
- Modify: `src/claude-app.ts`
- Modify: `tests/claude-app.test.ts`
- Modify: `tests/ui-api-apps.test.ts`

**Interfaces:**
- Consumes: `resolveClaudeAppCatalog`, `buildClaudeAppServerCatalog`, and `resolveFirstAvailableFavorite`.
- Produces: selected-plus-favorites behavior for direct, interactive, Favorites, and Admin UI boot launches.

- [ ] **Step 1: Write failing command-level tests**

Make the Claude App test preferences mutable. Add command tests that boot a selected model and assert:

```ts
expect(state.startServerOptions.catalog.list().map((model: ServerModelInfo) =>
  `${model.providerId}/${model.id}`,
)).toEqual([
  'selected/selected-model',
  'favorite/favorite-model',
]);
```

Add separate tests for a selected model duplicated in favorites and for 20 saved favorites producing exactly 20 catalog entries including the selected model.

Add an Admin UI test with `appId: 'claude-app'` and `favorites: true` that expects the spawned command to contain the first favorite's `--provider` and `--model` arguments.

- [ ] **Step 2: Run command/UI tests and verify RED**

Run: `npx vitest run tests/claude-app.test.ts tests/ui-api-apps.test.ts`

Expected: direct Claude App launch exposes only the selected model, so the selected-plus-favorites assertion FAILS.

- [ ] **Step 3: Replace the split launch branches**

In `runClaudeAppCommand`:

1. Keep `useFavorites` only for picker/session messaging.
2. When the provider picker returns `__favorites__`, call `resolveFirstAvailableFavorite(favorites, compatible)`. If none exists, warn and return `0`; otherwise assign its provider and model as the starting selection.
3. Remove the separate direct API-key block and the old Cloud Code favorites, regular favorites, Cloud Code single, and regular single branches.
4. Call `resolveClaudeAppCatalog(activeProvider, selectedModel, compatible, favorites)` for every launch.
5. Log `droppedFavorites` and `capacitySkippedFavorites` with provider/model ids.
6. If resolution fails, log the returned error and return `1`.
7. Inside the existing proxy lifecycle `try`, call `buildClaudeAppServerCatalog`, retain its backend for cleanup, and pass its `serverModels` to `createGatewayModelCatalog`.
8. Keep selected-model recent persistence disabled only when the user explicitly chose the Favorites picker.
9. When more than one server model is exposed, print a catalog line showing the total count alongside the selected model/provider.

Update help description to state that a selected model is combined with saved favorites.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/claude-app-model-catalog.test.ts tests/claude-app.test.ts tests/ui-api-apps.test.ts`

Expected: all focused files PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/claude-app.ts tests/claude-app.test.ts tests/ui-api-apps.test.ts
git commit -m "feat(claude-app): launch selected model with favorites"
```

---

### Task 4: Final verification

**Files:**
- Verify all modified files from Tasks 1–3.

**Interfaces:**
- Consumes: completed implementation.
- Produces: fresh evidence that the feature is safe to hand off.

- [ ] **Step 1: Run focused regression tests**

Run: `npx vitest run tests/claude-app-model-catalog.test.ts tests/claude-app.test.ts tests/ui-api-apps.test.ts`

Expected: all focused tests PASS with zero failures.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: all test files and tests PASS with zero failures.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: exit code `0` with no TypeScript errors.

- [ ] **Step 4: Run the production build**

Run: `npm run build`

Expected: exit code `0` and `ESM Build success`.

- [ ] **Step 5: Remove generated build output from the feature diff**

Run:

```bash
git stash push --include-untracked --message codex-claude-app-build-output -- dist
git stash show --stat --include-untracked stash@{0}
git stash drop stash@{0}
```

Expected: the stash contains only generated `dist` files and is dropped after the
source build has been verified.

- [ ] **Step 6: Inspect final scope**

Run:

```bash
git status --short
git diff origin/main...HEAD --stat
git log --oneline origin/main..HEAD
```

Expected: only the approved design/plan, Claude App catalog implementation, and related tests are present; no generated `dist` changes or unrelated files remain.

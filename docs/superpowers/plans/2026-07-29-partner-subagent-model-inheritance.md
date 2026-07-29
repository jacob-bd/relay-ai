# Partner Subagent Model Inheritance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude Code and Claude Desktop partner-model `Agent` calls inherit the exact active Relay AI model by default, while preserving explicit catalog selections and native Claude family aliases.

**Architecture:** Add a request-scoped routing policy shared by the CLI proxy and server gateway. The SDK request adapter augments only Claude Code-shaped `Agent` schemas, and the SDK response adapter normalizes completed `Agent` inputs before Claude sees them. Public/compatibility ids come from the same helpers used by gateway discovery, preventing transparent-mode and masked-id drift.

**Tech Stack:** TypeScript, Node.js HTTP, Vercel AI SDK v6, Vitest

## Global Constraints

- Work directly on `main` with Jacob's explicit approval.
- Follow strict TDD: observe each focused test fail before adding production behavior.
- Do not modify native Anthropic passthrough behavior.
- Do not add process-global current-model state or `CLAUDE_CODE_SUBAGENT_MODEL`.
- Do not mutate inbound request bodies or shared catalog objects.
- Keep large-catalog guidance bounded by `MAX_MODEL_CATALOG`.
- Preserve non-`Agent` streaming behavior byte-for-byte.
- Do not add Codex co-author metadata to commits.

---

## Task 1: Implement the pure subagent routing policy

**Files:**
- Create: `src/subagent-model-routing.ts`
- Create: `tests/subagent-model-routing.test.ts`

- [ ] **Step 1: Write failing tests for Claude Agent detection**

Cover:

```ts
isClaudeAgentTool({
  name: 'Agent',
  description: 'Launch an agent',
  input_schema: {
    type: 'object',
    properties: {
      description: { type: 'string' },
      prompt: { type: 'string' },
      subagent_type: { type: 'string' },
      model: { type: 'string', enum: ['sonnet', 'opus', 'haiku', 'fable'] },
    },
  },
}) === true;
```

Also prove that a name-only `Agent`, a non-`Agent` tool with the same schema, and malformed schemas return `false`.

- [ ] **Step 2: Run the focused test and observe failure**

Run: `npx vitest run tests/subagent-model-routing.test.ts`

Expected: failure because the module and helpers do not exist.

- [ ] **Step 3: Add the routing data model and strict schema detector**

Implement:

```ts
export type ClaudeModelFamily = 'sonnet' | 'opus' | 'haiku' | 'fable';

export interface SubagentModelOption {
  id: string;
  compatibilityIds: string[];
  displayName: string;
  family?: ClaudeModelFamily;
}

export interface SubagentModelRouting {
  parentModelId: string;
  models: SubagentModelOption[];
}
```

`isClaudeAgentTool` must require:

- `name === 'Agent'`
- an object `input_schema`
- object `input_schema.properties`
- `description`, `prompt`, and `subagent_type` properties

- [ ] **Step 4: Write failing routing-precedence tests**

Test all contract branches:

- `subagent_type: "fork"` remains unchanged
- missing, `null`, empty, whitespace, and `"inherit"` resolve to `parentModelId`
- exact exposed id is preserved
- exact compatibility id is rewritten to its exposed id
- `sonnet`/`opus`/`haiku`/`fable` select the first matching native family in catalog order
- unavailable family falls back to the parent and reports a `family-fallback` decision
- unknown explicit selector throws `UnavailableSubagentModelError`
- the error has HTTP status `400` and a bounded available-id message
- the original input object remains unchanged

- [ ] **Step 5: Run the focused test and observe the new failures**

Run: `npx vitest run tests/subagent-model-routing.test.ts`

Expected: detection passes; normalization tests fail because normalization is absent.

- [ ] **Step 6: Implement minimal normalization**

Export:

```ts
export type SubagentRoutingDecision =
  | { kind: 'inherit'; resolvedModelId: string }
  | { kind: 'compatibility'; requestedModelId: string; resolvedModelId: string }
  | { kind: 'family'; requestedModelId: ClaudeModelFamily; resolvedModelId: string }
  | { kind: 'family-fallback'; requestedModelId: ClaudeModelFamily; resolvedModelId: string }
  | { kind: 'explicit'; resolvedModelId: string }
  | { kind: 'fork' };

export interface NormalizedSubagentInput {
  input: Record<string, unknown>;
  decision: SubagentRoutingDecision;
}

export function normalizeClaudeAgentInput(
  input: unknown,
  routing: SubagentModelRouting,
): NormalizedSubagentInput;
```

Use a typed `UnavailableSubagentModelError` with `statusCode = 400`. Limit ids in its message to `MAX_MODEL_CATALOG`, plus an omission count for larger catalogs.

- [ ] **Step 7: Add failing schema-augmentation tests**

For catalogs up to `MAX_MODEL_CATALOG`, prove:

- the `model` enum retains the four built-in families
- all exposed ids are appended without duplicates
- compact display-name/id guidance is appended
- the exact parent id is identified as the default

For a catalog over the limit, prove:

- the cloned `model` property is `type: "string"` with no enum
- only the parent id is embedded
- the full catalog is not embedded

Also prove the original tool schema is unchanged.

- [ ] **Step 8: Implement schema augmentation and make all policy tests pass**

Export `augmentClaudeAgentTool`. Clone only the modified definition and nested schema/property objects. Preserve unrelated schema fields.

Run: `npx vitest run tests/subagent-model-routing.test.ts`

Expected: all tests pass.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/subagent-model-routing.ts tests/subagent-model-routing.test.ts
git commit -m "feat: add partner subagent routing policy"
```

---

## Task 2: Make gateway identity metadata authoritative

**Files:**
- Modify: `src/server/models.ts`
- Modify: `tests/server-models.test.ts`
- Modify: `tests/server-vendor-mask.test.ts`
- Modify: `src/proxy.ts`
- Modify: `tests/proxy.test.ts`

- [ ] **Step 1: Write failing server identity tests**

Add tests for a new exported helper:

```ts
gatewayModelIdentity(model, models, options)
```

It returns:

```ts
{
  publicId: exposedGatewayAliasId(model, options),
  compatibilityIds: string[],
}
```

Prove its compatibility ids are exactly the ids that `createGatewayModelCatalog` registers for:

- ordinary unmasked ids
- provider collisions
- masked gateway ids
- bare and `[1m]` variants

- [ ] **Step 2: Run the focused tests and observe failure**

Run:

```bash
npx vitest run tests/server-models.test.ts tests/server-vendor-mask.test.ts
```

Expected: failure because `gatewayModelIdentity` does not exist.

- [ ] **Step 3: Extract identity construction without changing discovery behavior**

Implement `gatewayModelIdentity` and refactor `createGatewayModelCatalog` to consume it. Keep catalog ordering and lookup precedence unchanged.

Derive native family only when:

```ts
model.modelFormat === 'anthropic' &&
(model.upstreamModelId ?? model.id).startsWith('claude-')
```

Export a server routing builder that maps catalog order to `SubagentModelOption[]`.

- [ ] **Step 4: Write failing proxy routing-context tests**

Add tests for an exported proxy helper that proves:

- `parentModelId` is `route.gatewayAliasId ?? route.aliasId`
- transparent mode never exposes an internal `relay:` alias
- compatibility ids contain accepted alias forms
- native family metadata comes only from real native Anthropic routes

- [ ] **Step 5: Run the proxy test and observe failure**

Run: `npx vitest run tests/proxy.test.ts`

Expected: failure because the proxy routing builder does not exist.

- [ ] **Step 6: Implement proxy routing context**

Build routing metadata only from the active `ProxyRoute[]` and the route returned by `lookupRoute`. Do not derive the parent from `body.model`.

- [ ] **Step 7: Run focused identity tests**

Run:

```bash
npx vitest run tests/server-models.test.ts tests/server-vendor-mask.test.ts tests/proxy.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/server/models.ts src/proxy.ts tests/server-models.test.ts tests/server-vendor-mask.test.ts tests/proxy.test.ts
git commit -m "refactor: share gateway subagent model identities"
```

---

## Task 3: Advertise catalog-aware Agent choices to partner models

**Files:**
- Modify: `src/sdk-adapter.ts`
- Modify: `tests/sdk-adapter.test.ts`

- [ ] **Step 1: Write failing translation tests**

Add request-translation tests proving:

- a Claude Code-shaped `Agent` tool is augmented
- an unrelated tool named `Agent` is untouched
- a non-`Agent` tool is untouched
- augmentation occurs after provider `maxTools` truncation
- a truncated-out Agent tool does not enable response normalization
- small and large catalogs follow the bounded guidance rules
- the input request body remains unchanged

- [ ] **Step 2: Run focused tests and observe failure**

Run: `npx vitest run tests/sdk-adapter.test.ts`

Expected: the new translated-schema assertions fail.

- [ ] **Step 3: Carry routing metadata through request translation**

Extend `TranslateRequestOptions` with optional `subagentRouting`.

Extend `SdkCallParams` with internal optional routing metadata, then destructure it before passing parameters to `streamText` or `generateText`:

```ts
const { subagentRouting, ...providerParams } = params;
```

After `resolveUpstreamTools` and `maxTools` truncation but before `translateTools`:

1. detect the Claude Agent schema in the tools actually retained
2. replace only that cloned tool with `augmentClaudeAgentTool(...)`
3. attach `subagentRouting` to `SdkCallParams` only when detection succeeded

- [ ] **Step 4: Run focused translation tests**

Run: `npx vitest run tests/sdk-adapter.test.ts`

Expected: all existing and new translation tests pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/sdk-adapter.ts tests/sdk-adapter.test.ts
git commit -m "feat: advertise relay models to Claude agents"
```

---

## Task 4: Normalize streamed and non-streamed Agent inputs

**Files:**
- Modify: `src/sdk-adapter.ts`
- Modify: `tests/sdk-adapter.test.ts`

- [ ] **Step 1: Write failing non-streaming tests**

Prove `generateAnthropicResponse`:

- injects the parent public id for an omitted model
- preserves an explicit exposed favorite id
- rewrites a compatibility id
- resolves a native family
- returns a clear 400-class error for an invalid selector
- leaves an unrelated `Agent` tool call unchanged when no detected schema metadata exists

- [ ] **Step 2: Run the focused test and observe failure**

Run: `npx vitest run tests/sdk-adapter.test.ts`

Expected: returned `tool_use.input` still contains the unnormalized input.

- [ ] **Step 3: Implement non-streaming normalization**

Normalize completed tool calls before constructing Anthropic `tool_use` blocks. Apply the same helper to the force-stream collection path. Emit trace lines for inheritance, compatibility rewrites, family selections, and family fallback.

- [ ] **Step 4: Write failing streaming-order tests**

Using synthetic AI SDK `fullStream` parts, prove:

- detected Agent input deltas are buffered
- exactly one normalized `input_json_delta` is emitted at the original block index after `tool-input-end`
- `content_block_stop` follows the normalized delta
- non-Agent input remains incremental
- the in-stream complete `tool-call` branch is normalized
- two interleaved Agent calls stay keyed by tool-call id
- an upstream error discards buffered deltas, closes the open block once, emits the error, and never emits a delta after stop
- an invalid selector closes the block before emitting a clear error event

- [ ] **Step 5: Run the focused test and observe failure**

Run: `npx vitest run tests/sdk-adapter.test.ts`

Expected: Agent deltas are emitted incrementally and model inheritance is absent.

- [ ] **Step 6: Implement buffered Agent streaming**

Track detected Agent calls by tool-call id:

```ts
interface BufferedAgentCall {
  blockIndex: number;
  toolName: string;
}
```

Suppress only their incremental input deltas. When the completed SDK `tool-call` arrives, normalize its full input and emit one JSON delta at the saved block index. Preserve all existing behavior for every other tool.

- [ ] **Step 7: Run focused adapter tests**

Run: `npx vitest run tests/sdk-adapter.test.ts`

Expected: all pass.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/sdk-adapter.ts tests/sdk-adapter.test.ts
git commit -m "feat: enforce partner subagent model routing"
```

---

## Task 5: Wire per-request routing into CLI proxy and server gateway

**Files:**
- Modify: `src/proxy.ts`
- Modify: `src/server/router.ts`
- Modify: `tests/proxy.test.ts`
- Modify: `tests/server-router.test.ts`

- [ ] **Step 1: Write failing proxy integration tests**

Prove the SDK adapter receives routing metadata based on the route actually selected by `lookupRoute`, including:

- default route fallback
- transparent `gatewayAliasId`
- a catalog containing partner and native Anthropic favorites
- recursive requests where the selected child route becomes the next parent

- [ ] **Step 2: Run the proxy tests and observe failure**

Run: `npx vitest run tests/proxy.test.ts`

Expected: translated requests have no subagent routing context.

- [ ] **Step 3: Wire proxy routing**

For SDK-backed routes only, pass `buildProxySubagentModelRouting(routes, route)` into `translateRequest`. Leave direct Anthropic forwarding unchanged.

- [ ] **Step 4: Write failing server integration tests**

Prove the server gateway:

- builds the parent public id from the resolved `ServerModelInfo`
- uses the full active server catalog for validation
- uses masked public ids when masking is enabled
- keeps request contexts independent for concurrent Qwen and Grok requests
- leaves native Anthropic passthrough unchanged

- [ ] **Step 5: Run server tests and observe failure**

Run: `npx vitest run tests/server-router.test.ts`

Expected: partner requests lack routing context.

- [ ] **Step 6: Wire server routing**

Build request-local routing metadata from the active `ModelCatalog` and gateway options, and pass it only into SDK-backed translation.

- [ ] **Step 7: Run focused integration tests**

Run:

```bash
npx vitest run tests/proxy.test.ts tests/server-router.test.ts tests/server-models.test.ts tests/server-vendor-mask.test.ts tests/sdk-adapter.test.ts tests/subagent-model-routing.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/proxy.ts src/server/router.ts tests/proxy.test.ts tests/server-router.test.ts
git commit -m "feat: inherit relay model in Claude subagents"
```

---

## Task 6: Regression verification and black-box proof

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Run static verification**

```bash
npm run typecheck
npm run build
git diff --check
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Re-run the fake Claude gateway probe**

Use the previously established black-box sequence:

1. Parent request arrives with the exposed Qwen id.
2. Fake partner response emits a Claude `Agent` call without `model`.
3. Claude's child request must use the same exposed Qwen id, not `claude-sonnet-5`.
4. Repeat with an explicit favorite id and verify the child uses that favorite.

Do not call a paid provider; keep the probe local.

- [ ] **Step 4: Inspect final scope**

```bash
git status --short
git diff --stat HEAD~5..HEAD
git log --oneline -8
```

Confirm no unrelated files, no generated artifacts, and no temporary probe files remain.

- [ ] **Step 5: Apply verification-before-completion**

Read and follow `superpowers:verification-before-completion`. Report exact command results and any accepted limitations from the approved design.


# Partner-model subagent routing — design

## Context

Claude Code and Claude Desktop can run non-Anthropic partner models through Relay
AI. Those models can invoke Claude Code's built-in `Agent` tool to start
subagents.

In the reported Claude Desktop session, Qwen invoked three `general-purpose`
agents without a model override. The Relay AI trace showed that the parent
requests used the selected Qwen gateway id, but all three child requests used
`claude-sonnet-5`, which was not in the session catalog. Relay AI returned the
correct `400 Unknown model` response.

A black-box probe against the bundled Claude runtime reproduced the same sequence
without calling a real provider:

1. The parent request used `anthropic-relay__qwen-probe`.
2. The `Agent` tool call omitted `model`.
3. The child request used `claude-sonnet-5`.
4. The next parent request returned to `anthropic-relay__qwen-probe`.

The probes also established these constraints:

- A newly advertised `claude-relay-*` id is rejected by the bundled client before
  it sends an API request, so changing the catalog prefix is not a viable fix.
- The `Agent` tool schema exposes `model` as an optional enum containing only
  `sonnet`, `opus`, `haiku`, and `fable`. Partner models are therefore not told
  that Relay AI catalog ids are valid subagent selections.
- When a custom agent has `model: sonnet` frontmatter and the visible `Agent` call
  omits `model`, the child request still uses `claude-sonnet-5`. The frontmatter
  value is not exposed in the tool input Relay AI can normalize.
- When the fake gateway returns an `Agent` call with an explicit
  `anthropic-*` gateway id, Claude accepts it and sends the child request with
  that id. Claude also accepts the `[1m]` picker variant, then strips `[1m]` from
  the child request; Relay AI's existing route lookup already accepts both forms.

Anthropic documents omitted subagent models as inheriting the main conversation,
but the current bundled runtime does not preserve that behavior for the custom
gateway id used by a partner model.

## Goals

- Make an automatically spawned subagent use the exact active partner parent
  model by default.
- Let the parent explicitly select any model exposed in the current Relay AI
  session catalog.
- Apply the behavior independently per request, so concurrent Qwen, Grok, Kimi,
  and other partner sessions cannot affect one another.
- Support recursive partner subagents: a partner child that launches another
  agent follows the same rules with itself as the new parent.
- Cover Claude Code CLI, Claude Desktop, and the shared Anthropic-format server
  gateway wherever the parent model uses the SDK adapter.
- Preserve existing native Anthropic passthrough behavior.
- Keep model-routing guidance compact and stable for prompt caching.

## Non-goals

- Do not route an unknown Claude model id to whichever model happened to launch
  Relay AI.
- Do not set `CLAUDE_CODE_SUBAGENT_MODEL`; it overrides explicit per-invocation
  choices and cannot represent concurrent Desktop sessions.
- Do not inject the model catalog into the general system prompt.
- Do not change the catalog size limit, favorites behavior, provider credential
  resolution, or upstream model ids.
- Do not infer a hidden custom-agent frontmatter model after Claude Code has
  omitted it from the visible `Agent` tool call. The runtime probe proves that
  Relay AI cannot distinguish this case from ordinary inheritance. Default
  partner inheritance therefore wins; an explicit favorite selection must be
  represented by the per-invocation `model` field.

## Routing contract

For a Claude Code `Agent` tool call emitted by an SDK-backed partner model, Relay
AI applies this precedence:

1. `subagent_type: "fork"` remains untouched because forks always
   inherit according to the client schema.
2. If `model` is omitted, `null`, empty, or `inherit`, Relay AI writes the exact
   public id of the route that served the parent request into `model`.
3. If `model` is an exact exposed catalog id, Relay AI preserves it.
4. If `model` is an exact compatibility id for the same catalog entry,
   Relay AI rewrites it to the exposed id.
5. If `model` is `sonnet`, `opus`, `haiku`, or `fable`, Relay AI resolves it to
   the first available native Claude entry of that family in catalog order. If
   no such entry exists, it degrades to the public parent id and records a trace
   warning instead of failing a common built-in/custom-agent workflow.
6. Any other explicit selector is rejected with a clear unavailable-model error.

The active gateway catalog served by that running Relay AI process is the
authority. A model available elsewhere but absent from that catalog is not
eligible.

## Considered approaches

### 1. Catalog-aware `Agent` tool translation and response normalization (chosen)

Relay AI augments the `Agent` tool schema sent to SDK-backed partner models and
normalizes the resulting tool call before converting it back to Anthropic SSE or
JSON.

This approach has the exact parent id and catalog at the translation boundary,
works per request, and does not depend on global state. It handles both model
awareness and enforcement.

### 2. `CLAUDE_CODE_SUBAGENT_MODEL`

Setting this environment variable to the launch model fixes one CLI process, but
Anthropic documents it as taking precedence over both per-invocation and
frontmatter choices. Claude Desktop can also run concurrent sessions with
different models under one app environment. It therefore violates both explicit
selection and session isolation.

### 3. Proxy fallback for unknown `claude-sonnet-*` ids

Mapping `claude-sonnet-5` to one default route could hide the immediate error in a
single session. The request carries no reliable parent route identifier, however,
so concurrent Qwen and Grok sessions could be crossed. It would also confuse an
intentional Sonnet selection with an accidental fallback.

## Internal design

### Subagent routing metadata

A focused shared module will represent only the data required by the adapter:

```ts
export interface SubagentModelOption {
  id: string;
  compatibilityIds: string[];
  displayName: string;
  family?: 'sonnet' | 'opus' | 'haiku' | 'fable';
}

export interface SubagentModelRouting {
  parentModelId: string;
  models: SubagentModelOption[];
}
```

The Claude Code proxy path derives ids from the route actually selected by
`lookupRoute`, not from the request body after other layers may have rewritten
it. Its public-id rule is:

```ts
route.gatewayAliasId ?? route.aliasId
```

This is required in transparent mode: the MITM layer rewrites the request model
to an internal `relay:{provider}:{model}` alias before forwarding to the SDK
adapter, while Claude Code only knows `route.gatewayAliasId`. It also handles the
existing `lookupRoute(...) ?? defaultRoute` fallback without injecting the
unrecognized inbound string.

The Claude Desktop/server path derives each option's public id with
`exposedGatewayAliasId(model, gatewayOptions)`. A shared gateway-alias helper will
produce both that public id and the exact compatibility-id set used by
`createGatewayModelCatalog`, so catalog lookup and subagent normalization cannot
drift. That set includes the real/bare id, scoped collision id, raw gateway
alias, masked alias, and applicable bare/`[1m]` variants.

Native Claude status and family are derived from the real model—not the masked
public id—using the real/upstream `claude-*` id and
`modelFormat === 'anthropic'`. The first matching entry in catalog order wins.
No process-global "current model" is introduced.

### Partner-model awareness

When translating tools for an SDK-backed request, Relay AI detects Claude Code's
`Agent` tool by both name and schema shape: the schema must contain
`properties.subagent_type` and the normal `description`/`prompt` fields. A
generic client's unrelated tool named `Agent` is left unchanged.

Relay AI clones the detected definition after `resolveUpstreamTools` and provider
tool-count truncation, but before `translateTools`. It makes bounded changes:

- Append a compact routing note stating that the parent id is the default and
  listing each available display name with its exact exposed id when the catalog
  is within the guidance limit.
- For catalogs of at most `MAX_MODEL_CATALOG`, extend the existing `model` enum
  with all exposed catalog ids while retaining the built-in Claude family values.
- For larger shared-server catalogs, replace the cloned model property's enum
  constraint with a plain string schema so an exact user-supplied catalog id
  remains legal. The compact note identifies the exact parent default and says
  that other explicit values must be exact ids from the session catalog; it does
  not enumerate the full catalog.

Relay AI does not modify other tools and does not mutate the client request body.
Claude App and CLI catalogs are capped, but the general server catalog is not, so
guidance has its own independent `MAX_MODEL_CATALOG` bound. Because a running
catalog is stable, the injected tool definition is prompt-cache stable.

The response adapter receives routing metadata only when that Claude Agent schema
was detected in the tools actually sent upstream. This prevents name-only output
normalization from affecting a generic client's unrelated `Agent` tool.

### Tool-call enforcement

A pure helper normalizes a completed `Agent` tool input against
`SubagentModelRouting`. It returns either the normalized input or a typed
unavailable-model result. Other tool calls pass through unchanged.

For streamed SDK output, the Anthropic response adapter buffers only detected
Claude `Agent` tool-input deltas, keyed by tool-call id. AI SDK v6 emits the
completed `tool-call` immediately after that tool's `tool-input-end`; this order
was verified against `runToolsTransformation` in the installed SDK. On the
completed part, Relay AI normalizes the SDK's complete input and emits one valid
`input_json_delta` at the buffered block index. The in-stream non-streamed
`tool-call` branch applies the same normalization. All other tools retain the
existing incremental pass-through behavior.

If an upstream error arrives before a buffered Agent call completes, Relay AI
discards its buffered deltas, closes the open block exactly once, and emits the
existing Anthropic error event. It never emits a delta after
`content_block_stop`.

For non-streaming SDK output, Relay AI normalizes each completed tool call before
building the Anthropic `tool_use` content block.

This changes the visible per-invocation tool input before Claude Code resolves the
subagent model. Claude Code therefore receives the exact parent or selected
favorite id instead of being asked to infer inheritance from an omitted value.

### Native Anthropic routes

Direct Anthropic-format passthrough remains byte-for-byte behaviorally unchanged.
Native Claude models already use Claude Code's supported family and full-model
identifiers. A partner parent can still explicitly choose a native Claude
favorite because the partner response passes through the SDK normalization path
before Claude Code launches the native child.

## Data flow

For default inheritance:

1. Claude Code sends a parent request with Qwen's exposed gateway id.
2. Relay AI resolves Qwen and builds routing metadata with the serving route's
   public id as the parent. In transparent mode this is `gatewayAliasId`, never
   the internal `relay:` alias.
3. Relay AI sends Qwen an `Agent` schema that identifies Qwen as the default.
4. Qwen emits an `Agent` call with no model or with `inherit`.
5. Relay AI writes Qwen's exact exposed gateway id into the tool input.
6. Claude Code launches the child with that id.
7. The gateway resolves the child request to Qwen.

For an explicit Grok favorite:

1. The parent request's injected `Agent` schema lists Grok's display name and
   exact exposed id.
2. The partner model emits that id in the `model` field.
3. Relay AI validates and preserves it.
4. Claude Code launches the child through the Grok route.

## Error handling and tracing

- An explicit selector absent from the active catalog produces a Relay AI
  unavailable-subagent-model error; it is never silently mapped to the parent.
- An unavailable built-in family alias is the exception: it degrades to the
  parent with a trace warning because Claude's client-relative family resolution
  is precisely what fails in partner-only catalogs.
- A malformed non-object `Agent` input is left to the existing tool-schema
  validation path.
- For a streaming unavailable-model error, Relay AI discards buffered input,
  closes the affected block, and then emits an Anthropic SSE `error` event. The
  bounded message lists up to `MAX_MODEL_CATALOG` available exposed ids and the
  count omitted, if any.
- A non-streaming normalization error is returned through the existing request
  error handling.
- Trace mode logs only the routing decision and safe catalog ids:
  `subagent model: inherit → <id>`, `explicit → <id>`, or
  `unavailable → <selector>`. It does not log prompts, credentials, or complete
  tool arguments.

## Compatibility

- Existing masked and unmasked gateway aliases remain accepted.
- Existing catalog discovery ids and display names remain unchanged.
- Non-`Agent` tools produce byte-equivalent Anthropic tool-call events.
- A generic tool named `Agent` without Claude Code's subagent schema produces
  byte-equivalent request and response behavior.
- Requests without an `Agent` tool receive no injected routing text.
- Native Anthropic passthrough is unchanged.
- The feature is derived from the request's catalog and requires no new user
  configuration.

## Test strategy

Tests are written before production changes and cover:

- missing, `null`, empty, and `inherit` model values becoming the parent id;
- transparent-mode routes using `gatewayAliasId ?? aliasId` for both guidance and
  inheritance, with no internal `relay:` id exposed;
- an exact exposed favorite id being preserved;
- an unmasked compatibility id becoming the exposed id;
- an available native `sonnet`, `opus`, `haiku`, or `fable` family resolving to
  the matching catalog entry;
- an unavailable family alias degrading to the parent with a trace warning;
- family derivation from a real native Claude id when the exposed id is masked;
- an unavailable explicit selector producing the typed error;
- `fork` calls remaining untouched;
- non-`Agent` tools remaining untouched;
- a generic `Agent` tool without `subagent_type` remaining untouched;
- the `Agent` description and enum receiving the bounded catalog additions;
- an uncapped server catalog with more than `MAX_MODEL_CATALOG` entries producing
  bounded, note-only guidance and a plain-string explicit selector;
- requests without `Agent` receiving no additions;
- a full streamed omission regression proving the single emitted
  `input_json_delta` parses to the public parent id;
- two sequential Agent calls retaining their individual block indexes;
- an Agent call followed by text flushing before block close;
- an upstream error during buffered Agent input discarding deltas and stopping
  the block exactly once;
- the in-stream non-streamed Agent branch receiving the same normalization;
- streamed non-`Agent` input retaining incremental pass-through;
- non-streaming tool calls receiving the same normalization;
- Claude Code proxy routing metadata using the serving route's public id and route
  catalog;
- Claude Desktop/server routing metadata using exposed masked ids and the shared
  catalog alias-key helper;
- simultaneous Qwen and Grok routing objects remaining independent;
- recursive partner-agent calls treating the child's inbound model as its parent.

Verification includes focused adapter, proxy, and server tests; the full Vitest
suite; TypeScript typecheck; production build; and a black-box fake-gateway probe
against the bundled Claude runtime showing Qwen→Qwen and Qwen→explicit Grok child
requests. The probe matrix covers normal CLI aliases, transparent
`gatewayAliasId`, masked Desktop ids, and their `[1m]` variants. CLI acceptance of
normal and `[1m]` aliases is already verified; Desktop and transparent-mode
acceptance remain release-gate checks before the feature is considered complete.

## Accepted limitations and residual risks

- When a custom agent's frontmatter model is omitted from the visible tool call,
  Relay AI cannot distinguish it from ordinary inheritance. The verified behavior
  is to inject the partner parent id, overriding that hidden frontmatter choice.
  Users who want a catalog favorite must make it an explicit per-invocation
  selection.
- Native Anthropic passthrough parents do not receive the augmented schema, so
  explicit partner-favorite selection from a native parent remains unchanged.
- Client acceptance of injected ids is version-dependent. The black-box matrix
  must be rerun for supported Claude Code/Desktop releases.
- The adapter already assumes Anthropic content blocks are serialized even if an
  SDK provider internally interleaves tool inputs. Per-id buffering does not
  expand that pre-existing limitation.

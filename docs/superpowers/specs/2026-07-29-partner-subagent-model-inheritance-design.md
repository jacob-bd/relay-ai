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

The probe also established two constraints:

- A newly advertised `claude-relay-*` id is rejected by the bundled client before
  it sends an API request, so changing the catalog prefix is not a viable fix.
- The `Agent` tool schema exposes `model` as an optional enum containing only
  `sonnet`, `opus`, `haiku`, and `fable`. Partner models are therefore not told
  that Relay AI catalog ids are valid subagent selections.

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
  omitted it from the visible `Agent` tool call. An explicit favorite selection
  must be represented by the per-invocation `model` field.

## Routing contract

For an `Agent` tool call emitted by an SDK-backed partner model, Relay AI applies
this precedence:

1. `subagent_type: "fork"` remains owned by Claude Code because forks always
   inherit according to the client schema.
2. If `model` is omitted, `null`, empty, or `inherit`, Relay AI writes the exact
   inbound parent gateway id into `model`.
3. If `model` is an exact exposed catalog id, Relay AI preserves it.
4. If `model` is an exact unmasked compatibility id for the same catalog entry,
   Relay AI rewrites it to the exposed id.
5. If `model` is `sonnet`, `opus`, `haiku`, or `fable`, Relay AI resolves it only
   when that family is represented by an available native Claude catalog entry.
   If more than one available entry has the same family, the first entry in
   catalog order wins.
6. Any other explicit selector is rejected with a clear unavailable-model error.

The gateway catalog for that running Relay AI process is the authority. A model
available elsewhere but absent from the selected-model-plus-favorites catalog is
not eligible.

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

The Claude Desktop/server path builds this structure from
`ModelCatalog.list()`, the gateway exposure options, and the inbound
`body.model`. The Claude Code proxy path builds it from its active
`ProxyRoute[]` and the inbound model id. No process-global "current model" is
introduced.

### Partner-model awareness

When translating tools for an SDK-backed request, Relay AI detects the exact
`Agent` tool and clones its definition. It makes two bounded changes:

- Append a compact routing note stating that the parent id is the default and
  listing each available display name with its exact exposed id.
- Extend the existing `model` enum with the exposed catalog ids while retaining
  the built-in Claude family values.

Relay AI does not modify other tools and does not mutate the client request body.
The catalog is already capped at `MAX_MODEL_CATALOG`, so the added text and enum
remain bounded. Because the catalog is stable for a running session, the injected
tool definition is also prompt-cache stable.

### Tool-call enforcement

A pure helper normalizes a completed `Agent` tool input against
`SubagentModelRouting`. It returns either the normalized input or a typed
unavailable-model result. Other tool calls pass through unchanged.

For streamed SDK output, the Anthropic response adapter buffers only `Agent`
tool-input deltas. When the SDK emits the completed `tool-call` part, Relay AI
normalizes the complete input and emits one valid `input_json_delta`. All other
tools retain the existing pass-through streaming behavior.

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
2. Relay AI resolves Qwen and builds routing metadata with Qwen as the parent.
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
- A malformed non-object `Agent` input is left to the existing tool-schema
  validation path.
- A streaming normalization error is emitted as an Anthropic SSE `error` event
  before the affected tool block is completed.
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
- Requests without an `Agent` tool receive no injected routing text.
- Native Anthropic passthrough is unchanged.
- The feature is derived from the request's catalog and requires no new user
  configuration.

## Test strategy

Tests are written before production changes and cover:

- missing, `null`, empty, and `inherit` model values becoming the parent id;
- an exact exposed favorite id being preserved;
- an unmasked compatibility id becoming the exposed id;
- an available native `sonnet`, `opus`, `haiku`, or `fable` family resolving to
  the matching catalog entry;
- an unavailable explicit selector producing the typed error;
- `fork` calls remaining untouched;
- non-`Agent` tools remaining untouched;
- the `Agent` description and enum receiving the bounded catalog additions;
- requests without `Agent` receiving no additions;
- streamed `Agent` input being buffered and emitted once after normalization;
- streamed non-`Agent` input retaining incremental pass-through;
- non-streaming tool calls receiving the same normalization;
- Claude Code proxy routing metadata using the inbound parent and route catalog;
- Claude Desktop/server routing metadata using the inbound parent and exposed
  masked catalog;
- simultaneous Qwen and Grok routing objects remaining independent;
- recursive partner-agent calls treating the child's inbound model as its parent.

Verification includes focused adapter, proxy, and server tests; the full Vitest
suite; TypeScript typecheck; production build; and a black-box fake-gateway probe
against the bundled Claude runtime showing Qwen→Qwen and Qwen→explicit Grok child
requests.

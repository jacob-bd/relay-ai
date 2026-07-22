# Claude App selected model plus favorites — design

## Context

`relay-ai claude-app` currently exposes either one explicitly selected model or a
catalog made only from saved favorites. This differs from the Codex launchers,
which keep the selected model as the starting entry and add saved favorites to the
same catalog.

Issue #27 surfaced the inconsistency in Claude Desktop/Cowork. Relay AI already has
the multi-model gateway needed by Claude Desktop, so there is no protocol blocker.
The only platform limitation is that Claude Desktop's third-party provider config
does not provide a supported field for forcing the initially active model. Relay AI
can put the selected model first in discovery, but Claude Desktop ultimately chooses
which entry is active when the app opens.

## Goals

- Make a specific Claude App selection expose the selected model plus saved
  favorites.
- Keep the selected model first in the discovered catalog.
- Match existing favorites behavior for credential resolution, target filtering,
  Cloud Code/OAuth routing, stale favorites, and catalog limits.
- Preserve today's one-model behavior when the user has no saved favorites.
- Fix the Admin UI Favorites launch indirectly through the same launch contract,
  without adding a UI-only code path.

## Non-goals

- Do not expose every model from the selected provider.
- Do not promise that Claude Desktop will activate the selected model on startup.
- Do not change how favorites are created or managed.
- Do not change Claude Code CLI, Codex CLI, Codex App, Gemini, or Antigravity launch
  behavior.

## Considered approaches

### 1. Automatically combine the selected model and favorites (chosen)

Whenever saved favorites exist, resolve the selected model first and append the
available favorites. Deduplicate by provider and model, and cap the final catalog at
`MAX_MODEL_CATALOG`.

This matches the other launchers and requires no new prompt, flag, or UI state.

### 2. Add an explicit "selected model + favorites" launch option

This preserves the current single-model selection as a separate mode, but adds a
choice users must understand in the CLI and Admin UI. It would keep the current
inconsistency unless users opt in each time.

### 3. Add all models from the selected provider, then favorites

This offers a larger switcher but violates Relay AI's existing catalog policy.
Providers such as OpenRouter can expose hundreds of models, which would create a
slow and noisy Claude Desktop catalog.

## User-visible behavior

When saved favorites exist and the user selects provider `P` and model `M`:

1. Relay AI resolves `P/M` as the selected entry.
2. Relay AI resolves the saved favorites that are valid for Claude App.
3. Relay AI builds the catalog as `[selected, ...favorites]`.
4. Relay AI removes duplicate provider/model pairs while preserving order.
5. Relay AI keeps at most `MAX_MODEL_CATALOG` entries, including the selected model.
6. Relay AI reports favorites it skipped because they are stale, unavailable,
   incompatible, or lack a required credential. Providers that explicitly allow
   anonymous access remain valid.
7. Relay AI starts the existing Claude Desktop gateway with the resulting catalog.

If `P/M` is already a favorite, it appears once at the front. If no favorites exist,
Relay AI exposes only `P/M`, preserving current behavior.

The existing `Favorites Catalog` picker entry remains available. It continues to
launch the saved favorites catalog, with its chosen starting item first.

## Admin UI behavior

The Admin UI currently turns a Favorites launch into the first favorite's
provider/model pair before spawning `relay-ai claude-app`. Under the new launch
contract, that selected first favorite is combined with all saved favorites, so the
UI receives the complete favorites catalog without a new command-line flag.

A direct model launch from the UI also gains the same selected-plus-favorites
behavior as an interactive CLI launch.

## Internal design

The implementation will converge both Claude App launch paths on one resolved list:

- Resolve the explicit or interactively selected provider/model.
- Resolve saved favorites through the existing shared favorites resolver and Claude
  App target filter.
- Prepend the selected entry before deduplication and the catalog cap.
- Partition Cloud Code entries through the existing shared Cloud Code backend.
- Map the converted entries back onto the original resolved order so backend-routed
  models are not moved ahead of or behind regular models.
- Convert the complete resolved list to `ServerModelInfo[]` and pass it to the
  existing `startServer` gateway.

The implementation must not reintroduce separate credential resolution logic.
Provider credentials should continue through the shared resolver so anonymous,
API-key, registry-reference, and OAuth-backed favorites behave consistently.

## Error handling

- Failure to resolve the explicitly selected model remains fatal and keeps the
  existing error message.
- A favorite that cannot be resolved is skipped and reported; it does not block the
  selected model from launching.
- If all favorites are skipped, the selected model still launches by itself.
- If catalog startup fails, every nested backend already started for Cloud Code
  entries must be closed through the existing cleanup path.

## Test strategy

Tests will be written before production changes and will cover:

- selected non-favorite followed by available favorites;
- selected model already present in favorites, with no duplicate;
- selected model with no saved favorites, preserving one-model behavior;
- stale, incompatible, and missing-required-credential favorites being skipped,
  while anonymous providers remain available;
- the catalog limit counting the selected model;
- selected and favorite entries that need the Cloud Code backend;
- Admin UI Favorites launch resolving to the full favorites catalog through the
  normal Claude App command;
- existing `Favorites Catalog` behavior remaining unchanged.

Verification will include the focused Claude App/UI tests, full test suite,
typecheck, and production build.

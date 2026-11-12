# Todo (v0.22.6)

## Antigravity Usage Quota Alignment & Relay UI Clarity
- [x] Investigate root cause (`parseAntigravityUsage` in `src/usage/parse.ts` and `antigravityUsage` in `src/core/usage.ts` vs live `retrieveUserQuotaSummary` & `fetchAvailableModels` APIs)
- [x] Add `parseAntigravityQuotaSummary()` in `src/usage/parse.ts` to parse `v1internal:retrieveUserQuotaSummary` (`groups[].buckets[]`) into aligned `RelayUsageWindow[]`
- [x] Fix `parseAntigravityUsage()` fallback in `src/usage/parse.ts` so `gemini-4-hydrogen-*` shares the `gemini` pool instead of duplicating `Gemini 4 models`
- [x] Update `antigravityUsage()` in `src/core/usage.ts` to query `v1internal:retrieveUserQuotaSummary` first and fall back to `v1internal:fetchAvailableModels`
- [x] Label percentages explicitly as `% used` in Relay UI (`src/ui/public/app.js`, `src/ui/public/style.css`)
- [x] Add/update unit tests in `tests/usage-parse.test.ts` and `tests/core-usage.test.ts`

## Expose Gemini 4 Hydrogen `xhigh` (Extra) Effort Across CLI Tools & Core
- [x] Update `src/provider-factory.ts` (`GEMINI_HYDROGEN_EFFORT_LEVELS`, `isGeminiHydrogenModel`, bridged Antigravity Gemini over `@ai-sdk/anthropic`, `@ai-sdk/google` `xhigh` middleware + fetch body rewrite)
- [x] Update `src/core/antigravity-model.ts` (`createCloudCodeFetch` to strip internal header and rewrite `thinkingConfig.thinkingLevel` to `xhigh`)
- [x] Update `src/antigravity/anthropic-to-cloudcode.ts` (forward `output_config.effort` on `gemini-4-hydrogen*` without changing fixed-slot models like `gemini-3-flash-extra-low`)
- [x] Update `src/codex/catalog.ts`, `src/codex/favorites-catalog.ts`, and `src/gemini-proxy.ts` so `cloud-code` Gemini catalogs and Gemini CLI preserve `xhigh`
- [x] Add unit tests in `tests/reasoning-capabilities.test.ts`, `tests/provider-factory.test.ts`, `tests/antigravity-anthropic-to-cloudcode.test.ts`, `tests/core-antigravity-model.test.ts`, and `tests/codex-catalog.test.ts`

## Release v0.22.6 Prep & Publish
- [x] Fold PR #91 + usage fixes + Hydrogen `xhigh` + `% used` UI fix into `CHANGELOG.md`
- [x] Commit locally on `main` (`release: v0.22.6`)
- [x] Push `main` to `origin/main` (PR #91 marked merged)
- [x] Tag `v0.22.6` and push tag to trigger GitHub Action
- [x] Follow CI workflow run (`Publish to npm`) to green completion
- [x] Verify published release on GitHub (`v0.22.6`) and npm registry (`@jacobbd/relay-ai@0.22.6`)

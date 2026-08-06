# ClinePass Unified Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CLI provider wizard present ClinePass API-key and OAuth authentication as two methods of one provider, including safe switching for an existing entry.

**Architecture:** Keep the existing `addProviderFromTemplate` API-key path and `authenticateProvider` OAuth path. Add a small CLI orchestration helper in `src/providers-command.ts` that presents the shared auth choice, routes each method to its existing implementation, and uses `replaceExisting` for API-key switches. Filter dual-auth templates out of the separate OAuth-only discovery menu.

**Tech Stack:** TypeScript, `@clack/prompts`, Vitest, existing Relay AI registry/keyring modules.

## Global Constraints

- Keep one registry provider id: `cline-pass`.
- Preserve the existing ClinePass endpoint, model IDs, model catalog, and billing semantics.
- Never expose or log API keys or OAuth tokens.
- Use existing credential cleanup behavior when switching auth methods.
- Follow TDD: each behavior change gets a failing test before production code.

### Task 1: Add failing tests for unified ClinePass auth

**Files:**
- Modify: `tests/providers-command.test.ts`
- Modify: `tests/provider-templates.test.ts`

**Interfaces:**
- Exercise `runProvidersAdd` and the provider-hub/detail flow through their public exports and mocked prompt/network boundaries.
- Assert observable prompt choices, calls to `addProviderFromTemplate`/`authenticateProvider`, and removal of ClinePass from OAuth-only discovery.

- [ ] **Step 1: Add prompt and dependency mocks needed to drive the interactive flows.**

  Mock `select`, `password`, `spinner`, `addProviderFromTemplate`, `authenticateProvider`, and registry state while preserving the existing provider-command tests.

- [ ] **Step 2: Write the failing new-provider test.**

  Drive `runProvidersAdd()` through `templates → search → ClinePass → oauth`, then assert the CLI calls `authenticateProvider('cline-pass')` and does not call `addProviderFromTemplate`.

- [ ] **Step 3: Write the failing API-key test.**

  Drive the same flow through `api`, enter a key, and assert the CLI calls `addProviderFromTemplate(clineTemplate, key, { replaceExisting: false })`.

- [ ] **Step 4: Write the failing existing-provider switching test.**

  Drive the ClinePass detail menu through `Change authentication → API key`, enter a new key, and assert `{ replaceExisting: true }`. Add the OAuth direction assertion through `Change authentication → OAuth` and assert `authenticateProvider('cline-pass')`.

- [ ] **Step 5: Write the failing OAuth-discovery filter test.**

  Assert `listVisibleOAuthTemplates()` contains OAuth-only providers but not `cline-pass`.

- [ ] **Step 6: Run the focused tests and verify they fail for the missing behavior.**

  Run:

  ```bash
  npx vitest run tests/providers-command.test.ts tests/provider-templates.test.ts
  ```

  Expected: the new assertions fail because ClinePass currently has no shared CLI auth choice and remains in the OAuth discovery list.

### Task 2: Implement the shared CLI auth flow

**Files:**
- Modify: `src/providers-command.ts`
- Modify: `src/provider-templates.ts`

**Interfaces:**
- Add a private `runDualAuthTemplateFlow(template, existing?)` helper in `providers-command.ts`.
- Use `authenticateProvider('cline-pass')` for OAuth and `addProviderFromTemplate(template, key, { replaceExisting: Boolean(existing) })` for API.

- [ ] **Step 1: Add the dual-auth branch to the Add-provider flow.**

  After selecting a template, route templates whose `authMethods` include both `api` and `oauth` through the shared method prompt. Keep the current generic flow unchanged for API-only, OAuth-only, custom, and cloud templates.

- [ ] **Step 2: Implement the API-key branch.**

  Ask for the ClinePass API key, validate non-empty input, run the existing add function under the existing connection spinner, pass `replaceExisting` only for an existing provider, and report success/errors using current CLI conventions.

- [ ] **Step 3: Implement the OAuth branch.**

  Call `runProvidersAuth('cline-pass')` so the existing device-code flow, credential storage, provider upsert, model refresh, and error handling remain the single implementation.

- [ ] **Step 4: Add the existing-provider switch action.**

  In `runProviderDetail`, add `Change authentication (API/OAuth)` for templates with both methods. Route that action through the same helper with the current registry provider.

- [ ] **Step 5: Exclude dual-auth templates from the separate OAuth menu.**

  Update `listVisibleOAuthTemplates` to return OAuth-capable templates that are not also API-capable. Preserve OAuth-only discovery and configured-provider filtering.

- [ ] **Step 6: Run the focused tests and confirm green.**

  Run:

  ```bash
  npx vitest run tests/providers-command.test.ts tests/provider-templates.test.ts
  ```

### Task 3: Verify the release build and CLI artifact

**Files:**
- No source changes expected unless verification exposes a regression.

- [ ] **Step 1: Run the full test suite.**

  ```bash
  npm test
  ```

- [ ] **Step 2: Run typecheck and build.**

  ```bash
  npm run typecheck
  npm run build
  ```

- [ ] **Step 3: Run release metadata checks and verify version.**

  ```bash
  npm run release:check
  relay-ai --version
  ```

- [ ] **Step 4: Report the exact CLI test path.**

  Tell the user to run `relay-ai providers`, choose `+ Add a provider`, select ClinePass, and then choose API key or OAuth. For an existing ClinePass entry, select it and choose `Change authentication (API/OAuth)`.

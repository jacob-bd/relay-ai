# ClinePass Unified Authentication Design

## Goal

Treat ClinePass as one provider in Relay AI, with API-key and OAuth/device-code authentication presented together in both the interactive CLI provider wizard and the existing provider-management flow.

## Context

ClinePass usage is tied to the ClinePass account/quota when the user uses a ClinePass API key and `cline-pass/...` models. OAuth and API key are credential mechanisms for the same provider, not separate Relay providers or separate model catalogs. The UI already presents both choices together; the CLI currently asks only for an API key during provider addition and exposes OAuth through a separate menu.

## Design

- Keep one provider id: `cline-pass`.
- When ClinePass is selected from the Add-provider wizard, prompt for `API key` or `OAuth/device code`.
- API-key setup validates the key, fetches the public ClinePass catalog, and stores `keyring:provider:cline-pass`.
- OAuth setup runs the existing native ClinePass device-code flow and stores `keyring:oauth:provider:cline-pass`.
- When an existing ClinePass entry is opened, offer the same authentication choice as a `Change authentication` action. Switching methods replaces the provider entry and deletes the superseded credential through the existing safe cleanup paths.
- Remove ClinePass from the separate OAuth discovery menu so users do not see duplicate setup paths. OAuth-only providers remain there.
- Do not change ClinePass model IDs, endpoint routing, billing behavior, or context-window metadata.

## Error handling

- Cancellation returns to the current wizard without changing registry or credentials.
- API-key validation/catalog failures use the existing spinner and error reporting.
- OAuth failures use the existing `runProvidersAuth` handling.
- Credential replacement is committed only after the new credential/model setup succeeds; the existing credential remains intact on failure.

## Verification

- Test the new-provider API and OAuth choices.
- Test existing-provider switching in both directions and assert superseded credential cleanup.
- Test that ClinePass is excluded from the separate OAuth discovery list while OAuth-only providers remain.
- Run the full test suite, typecheck, build, and release checks.

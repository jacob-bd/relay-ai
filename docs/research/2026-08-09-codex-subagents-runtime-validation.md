# Codex SubAgents Runtime Validation

Date: 2026-08-09 (America/Toronto)

This record contains sanitized observations only. It does not contain OAuth tokens, account identifiers, provider keys, delegated plaintext, or encrypted-content values.

The early hidden-catalog recommendation below was superseded by the codex-router-compatible design. In the implemented mixed mode, configured Codex SubAgents models are first-class `visibility: "list"` entries with `multi_agent_version: "v2"`; hidden entries are not eligible for Codex model overrides.

| Experiment | Runtime | Result | Consequence |
|---|---|---|---|
| `codex --version`, `debug models`, `debug models --bundled` | Local standalone `/Users/jbendavi/.nvm/versions/node/v22.22.2/bin/codex`, `codex-cli 0.146.1` | PASS; both commands returned valid JSON with eight native models | CLI catalog capture is supported for this fingerprint |
| Same catalog commands | Remote embedded `/Applications/ChatGPT.app/Contents/Resources/codex`, `codex-cli 0.147.0-alpha.6.5` | PASS; valid JSON, eight models, `visibility` values `list`/`hide`, `multi_agent_version` values `v1`, `v2`, and absent | Desktop uses a separately captured catalog; its fingerprint is not inferred from the standalone CLI |
| Remote `/opt/homebrew/bin/codex` wrapper | Remote host | BLOCKED by an installation defect: wrapper points to a missing native executable and returns `ENOENT` | Not a product-support result; embedded runtime remains the Desktop authority |
| Synthetic catalog overlay | Local CLI and remote embedded binary | PASS; a synthetic model is accepted by normal catalog loading | Mixed catalog must preserve native objects and expose configured Codex SubAgents as first-class `visibility: "list"` entries |
| Runtime-required role shape | Remote embedded binary | PASS with `name`, `model`, and non-empty fixed Relay-owned `developer_instructions`; a literal model-only TOML file is rejected | User catalog stays model-only; Relay generates the required fixed runtime metadata |
| Hidden exact-model spawn | Local CLI and remote embedded binary | PASS for the tested V1/V2 paths; one full-history fork warning was reproduced and avoided when the harness requested a normal spawn | Mixed launch must not force full-history forks and must record a runtime warning as a compatibility signal |
| Native Responses HTTP/SSE | Local authenticated Codex backend | PASS for bounded streaming and native headers | Mixed proxy can forward native HTTP without translating the request |
| Native forced-tool byte corpus | Local native backend | Partial: ordinary bounded samples matched; default output budget truncated some 16–64 KiB single-call samples | Production relay must bound the bridge and cannot promise arbitrary-size one-call transport |
| Real V2 opaque collaboration payload | Remote embedded child output → authenticated native model-mediated bridge | PASS; one live `agent_message` with opaque `encrypted_content` was relayed through exactly one forced transport call, returned a non-empty decoded payload, and preserved the synthetic marker. No warnings were emitted. | Relay does not decrypt locally; it resolves native ciphertext through the authenticated native backend and fails closed on any resolution error |
| Ciphertext inspection | Remote disposable homes | PASS; only field names and byte lengths were recorded. Observed encrypted-content fields were small (under approximately 1.2 KiB) in the tested sessions | Do not log ciphertext; use bounded transport and cache limits |
| Responses-Lite WebSocket | Existing Relay adapter tests | PASS for Relay's outbound adapter shape and frame normalization. A TLS MITM was not used. | Mixed proxy includes a separate capability-gated WebSocket forwarding path; live Desktop E2E remains a release gate |

## Security conclusions

- Native model slugs are checked before Relay routes. Unknown mixed slugs return an error; they never fall back to the first Relay route.
- Mixed requests use a random per-session loopback capability path. Relay-only requests retain the existing placeholder-key contract.
- Native authorization and account headers are allowlisted only for the native upstream. Relay provider credentials are held in Relay routes and are not forwarded to the native upstream.
- Native collaboration ciphertext is opaque to Relay. The model-mediated bridge is transport validation, not cryptographic verification; Relay cannot independently prove recovered plaintext equality on each production request.
- Trace body dumps structurally redact credentials, ciphertext, and collaboration content before serialization.

## Remaining release gates

The implementation is not a claim of full production confidence until the remote Desktop launch/quit/restore scenario is exercised with the exact installed ChatGPT app, native WebSocket forwarding is observed end-to-end without TLS interception, and the mixed launch is tested against at least one real Relay provider plus a native model in the same session.

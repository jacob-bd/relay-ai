# Changelog

## [0.2.2] - 2026-06-05

- Simplified dry-run key-save logging in `resolveOrCollectApiKey` — replaced a 7-branch `if-else` chain with a `Record<SaveChoice, string>` lookup table. No behavioral change.

## [0.2.1]

- Changed the Claude Code launch path to the `opencode-starter claude` command namespace. Bare `opencode-starter` now prints help and migration guidance instead of launching Claude Code.
- Preserved passthrough Claude Code args after `claude`, including `-c`, `--resume <session-id>`, session IDs, and args after `--`.
- Added foreground `opencode-starter server` mode for local or LAN API gateway use.
- Added Anthropic-compatible and limited OpenAI-compatible server endpoints.
- Moved app preferences and model cache to `~/.opencode-starter/config.json`.
- Added one-time migration from the previous OS-native config path.
- Added opt-in saved server password support for network server mode.
- Updated documentation with the supported tools command table, Claude examples, dry-run/setup/trace placement, and migration note.
- Added MIT license file.

# Cursor → Relay provider analysis (opencode-cursor)

- **Date:** 2026-11-11
- **Location:** `docs/plans/` (gitignored via `docs/plans/` in `.gitignore`)
- **Status:** Discovery / feasibility log (no implementation started)
- **Source analyzed:** [`ephraimduncan/opencode-cursor`](https://github.com/ephraimduncan/opencode-cursor) (`main`, commit `621116d`, 2026-08-21), README + `package.json` + `src/index.ts` + `src/v2.ts` + `src/auth.ts` + `src/models.ts` + `src/proxy.ts` (partial, 1770 LOC total) + `src/native-tools.ts` + `src/h2-bridge.mjs`
- **Local codebase:** `relay-ai` @ `0.21.1` (`/Users/jbd/dev_projects/relay-ai`)

> Note: GitHub raw/API fetches were used for external repo inspection; generated protobufs (`src/proto/agent_pb*`) and a few runtime scripts were not fetched directly, so protocol/message details below are inferred from imports and usage.

---

## 1. Executive summary / viability verdict

### What opencode-cursor does
It is an **OpenCode plugin** that lets a user access Cursor-subscription models inside OpenCode by:
1. doing **Cursor OAuth (PKCE + browser login + poll)** and token refresh,
2. discovering available models via Cursor’s private **gRPC/Connect AgentService** (`GetUsableModels`),
3. running a **local OpenAI-compatible proxy** (`/v1/chat/completions`, `/v1/models`) that translates requests into Cursor’s **protobuf/Connect-over-HTTP2 `AgentService/Run`** stream (via a Node `h2-bridge` child process, because Bun’s `http2` is unreliable there),
4. handling Cursor’s **agent/tool execution protocol** (MCP tool defs in request context, exec pause/resume, native-tool redirection/rejection, blob KV, conversation checkpoints) and persisting conversation state to disk.

This is **not** a normal REST provider integration; it is a reverse-engineered, stateful protocol gateway.

### Freshness correction
The request stated the repo “has not been updated 23 months”. Current evidence does **not** support that:
- Repo created **2026-03-19**, last push **2026-08-21** (`pushed_at` from GitHub API), 32 commits, latest release/tag context around v0.2.0.
- Recent work includes OpenCode v2 support, auto-model routing, conversation/blob-state fixes, native tool redirection, and model/catalog fixes.
- There *is* maintenance pressure: open PRs/issues indicate **OpenCode v2 stable API drift/breakage** (#44/#43/#42/#39), HTTP/1.1 fallback needs (#41), Node/Desktop runtime portability (#36), and other edge cases (#33/#34). So it is **recent but fragile/partly lagging current host APIs**, not abandoned for years.

### Viability assessment (for turning this into a Relay provider)

| Dimension | Assessment | Why |
|---|---|---|
| Technical feasibility | **Medium, but high effort** | Protocol is complex (protobuf/Connect/H2, Run stream, KV blob store, checkpoints, exec/tool resume, native-tool result synthesis). Doable if proto/runtime are vendored and ported to Node, similar in complexity to Relay’s bespoke gateways (Antigravity/cloud-code). |
| Protocol stability | **Low** | Depends on private endpoints (`api2.cursor.sh`, AgentService RPCs), client/version headers, and Cursor’s internal agent semantics. Upstream issues/commits already show repeated break/fix cycles (“Blob not found”, tool routing, model discovery, host API changes). |
| Runtime fit in Relay | **Medium** | Relay is Node/TS (tsup) and SDK-first; opencode-cursor relies on Bun APIs (`Bun.serve/spawn/sleep`) and a Node H2 bridge + protobuf runtime. Needs a clean Node port and careful lifecycle management inside Relay’s process model. |
| Product/ToS risk | **High** | Uses end-user Cursor subscription credentials against non-public surfaces (subscription extraction). Comparable to other `subscriptionRisk` flows (Claude Code / Antigravity / ClinePass) and may violate Cursor ToS or trigger account restrictions. Needs explicit opt-in/risk UX. |
| Strategic/product viability | **Low–Medium (uncertain, trending worse)** | 2026 xAI/Cursor unification changes the landscape (see §5): “The X Subscription” unifies Grok/Cursor/X; Grok Bot included with Cursor plans; Cursor docs present Grok 4.6/4.7 as first-party Cursor-catalog models. This can shift backend/auth/model surfaces and reduces the long-term value of reverse-engineering Cursor’s agent backend. However, the plugin’s core value is “Cursor subscription models in another client” via AgentService — that path may still function independently of UI/product bundling until Cursor changes it. **Live compatibility is unverified here** (no Cursor credentials/test run). |

**Bottom line:** Implementing as a Relay provider is **technically plausible but expensive to build and maintain, and strategically risky**. Recommended only as an **explicitly experimental, `subscriptionRisk`, best-effort** integration with clear “may break / unofficial” positioning — and only after a spike proves current AgentService/auth/model-discovery still work end-to-end against today’s Cursor backend.

---

## 2. Deep analysis — `opencode-cursor`

### 2.1 Package & integration surfaces
- **Package:** `opencode-cursor-oauth@0.2.0`, ESM, Node >= 18, Bun used in dev/runtime assumptions.
- **Exports:** `.` -> `dist/index.js` (v1 plugin), `./server` -> `dist/v2.js` (v2 plugin).
- **Deps:** `@bufbuild/protobuf`, `@opencode-ai/plugin` (beta), `@opencode-ai/sdk`, `zod`.
- **V1 (`src/index.ts`, default `CursorAuthPlugin`)** hooks into OpenCode v1:
  - `config`: injects provider stub + discovered models into config (workaround for opencode >=1.18 catalog timing; issue #30).
  - `provider.models` (v2 catalog hook in v1 host path): returns discovered models backed by local proxy when oauth auth exists.
  - `auth.provider="cursor"` with `loader` (ensures valid token, refreshes/persists, starts proxy, returns `baseURL http://localhost:<port>/v1`, dummy `apiKey`, strips outbound Authorization) and `methods: [{type:'oauth', label:'Login with Cursor', authorize()->{url,instructions,callback}}]`.
- **V2 (`src/v2.ts`)** uses `Plugin.define` + `ctx.integration.transform/reload`, `ctx.catalog.transform/reload` (beta SDK shape — note open issues show stable hosts moved away from this), watches connection updates, clears model cache on reconnect, stops proxy on teardown.

### 2.2 Authentication (`src/auth.ts` + `src/pkce.ts`)
- **Constants/endpoints:**
  - Login: `https://cursor.com/loginDeepControl` with `challenge, uuid, mode=login, redirectTarget=cli`.
  - Poll: `https://api2.cursor.sh/auth/poll?uuid=&verifier=`.
  - Refresh: `POST https://api2.cursor.sh/auth/exchange_user_api_key` (override `CURSOR_REFRESH_URL`) with `Authorization: Bearer <refreshToken>`, JSON `{}` body.
- **Login flow:** generate PKCE `{verifier,challenge}` + `uuid`, open browser to login URL, poll until `{accessToken, refreshToken}`. Polling: 404 => backoff (1s base, ×1.2, cap 10s, 150 attempts max); other non-OK counts consecutive errors and aborts at 3; generic network errors also count.
- **Token model:** JWT `exp` parsed with 5-minute safety margin; fallback `now + 1h` on parse failure. Refresh returns `{access, refresh, expires}`; keeps old refresh if response omits rotation.
- **Storage/use (v1):** reads OpenCode auth store (`auth.json` / `XDG_DATA_HOME` / `OPENCODE_AUTH_CONTENT`) for provider `cursor` oauth record; refresh-on-read and best-effort persist rotated tokens via `input.client.auth.set`. V2 resolves via integration connection APIs.

### 2.3 Model discovery (`src/models.ts`)
- **RPC:** unary `POST /agent.v1.AgentService/GetUsableModels` (empty request) via `callCursorUnaryRpc` over H2 bridge (`unary: true`, default 5s timeout).
- **Response handling:** decode `GetUsableModelsResponse` (raw proto or Connect-unary framed body; skips compressed/end-stream trailer frames).
- **Normalization:** Zod parse (`modelId` required; name from `displayName|displayNameShort|displayModelId|aliases|id`; `reasoning = !!thinkingDetails`).
- **Limits/cost:** hard defaults `contextWindow=200_000`, `maxTokens=64_000` (not returned by this RPC path). Cost is a local estimate table/pattern map in `index.ts` for display.
- **Catalog behavior:** in-process cache (`cachedModels`, clearable); fallback `FALLBACK_MODELS` on failure/empty; always injects synthetic **`auto`** model (mapped to server model `default` in Run requests). Returned as OpenAI-compatible models targeting local proxy (`@ai-sdk/openai-compatible`).

### 2.4 Transport — Node HTTP/2 bridge (`src/h2-bridge.mjs`)
- **Why:** Bun’s `node:http2` unreliable against Cursor API.
- **IPC:** length-prefixed `[4B BE len][payload]` over stdin/stdout.
  - 1st stdin msg: JSON config `{accessToken,url,path,unary}`.
  - Streaming: subsequent stdin payloads written to H2 stream (parent sends Connect-framed bytes), EOF/zero ends write.
  - Unary: one body then end stream.
  - stdout: length-prefixed H2 response chunks.
- **H2 request:** `POST` to RPC path on `https://api2.cursor.sh` (default), headers include `authorization`, `x-ghost-mode: true`, `x-cursor-client-version: cli-2026.01.09-231024f`, `x-cursor-client-type: cli`, `x-request-id`, `te: trailers`; streaming uses `content-type: application/connect+proto` + `connect-protocol-version: 1`, unary uses `application/proto`.
- **Timeouts:** 30s initial, reset to 120s on data; exits/kills on timeout/error/end.
- **Parent side (`spawnBridge`)**: Bun.spawn of `node <BRIDGE_PATH>`, stdout reassembly, `write/end/onData/onClose/alive`, immediate close callback if already exited (prevents hung streams).

### 2.5 Proxy & protocol translation (`src/proxy.ts`)
Core of the system (1770 LOC; analyzed ~first 1570 + structural behavior).

**Server:** `Bun.serve` on `127.0.0.1:0`, `idleTimeout: 255`.
- `GET /v1/models` -> OpenAI model list.
- `POST /v1/chat/completions` -> translate/stream/non-stream via Cursor Run.

**State & identity keys:**
- `bridgeKey = sha256("bridge:"+modelId+":"+firstUserText[:200])` — live tool-call continuation bridge (model-specific).
- `convKey = sha256("conv:"+firstUserText[:200])` — conversation/checkpoint/blob state (model-independent).
- In-memory `conversationStates` (30m TTL eviction) + disk cache `~/.cache/opencode-cursor/conversations/<convKey>.json` (7d TTL, pruned on start, fire-and-forget persist). Stored: `conversationId`, `checkpoint` (b64), `blobStore` map, `lastAccessMs`.
- `activeBridges` keep an H2 Run stream alive across HTTP requests while waiting for tool results.

**OpenAI -> Cursor request build (`parseMessages`/`buildCursorRequest`):**
- Splits system prompts, ordered history (`user`/`assistant`/`tool` -> `[Tool Result]\n...` text), trailing user text becomes active action, collected tool results for resume.
- **Blob-addressed protocol:** `*Structure` byte fields must be **sha256 content IDs**, not inline bytes (avoids “Blob not found”, #22/#29). Helper stores blobs in `blobStore` and references hashes; includes deterministic UUID/message-id derivation for cache warmth across restarts.
- Rebuilds `rootPromptMessagesJson` from system + full history on every request (server prompt source of truth); rebuilds `turns[]`; preserves non-history checkpoint fields only if system-prompt head matches.
- Action: `userMessageAction` when trailing user text exists, else `resumeAction`.
- `auto` -> server model `default`; sets `requestedModel` + `modelDetails`.
- System prompt sent via `RequestContext.cloudRule` (honored channel, per #21). MCP tool defs (`OpenAI tools -> McpToolDefinition` protobuf, JSON schema encoded as protobuf `Value`) attached in request context.

**Run stream handling:**
- Send initial Connect-framed `AgentClientMessage(runRequest)`; 5s `clientHeartbeat`.
- Stateful Connect frame parser (`[flags][len][payload]`, end-stream flag -> error JSON).
- Server message dispatch:
  - `interactionUpdate`: `textDelta` -> content (through thinking-tag filter `<think|thinking|reasoning|thought|think_intent>` -> `reasoning_content`), `thinkingDelta` -> reasoning, `tokenDelta` usage accumulation.
  - `kvServerMessage`: `getBlobArgs`/`setBlobArgs` served from local blob store.
  - `execServerMessage`: context + tool execution (below).
  - `conversationCheckpointUpdate`: capture token totals and persist checkpoint + merged blobs.

**Tool/exec semantics (critical):**
- `requestContextArgs` -> respond with `RequestContextSuccess` (cloudRule, MCP tools, empty env context fields).
- `mcpArgs` -> decode args (protobuf `Value`), emit OpenAI `tool_calls` SSE chunk, set `finish_reason: tool_calls`, keep bridge alive in `activeBridges` for continuation, close SSE to client. Next request with tool results resumes bridge by sending results.
- **Native tool redirection (`src/native-tools.ts`)** — maps Cursor-native execs to client-provided OpenAI tools when available:
  - `readArgs -> read(filePath)`
  - `writeArgs -> write(filePath,content)` (+ result size/lines metadata)
  - `fetchArgs -> webfetch|fetch|web_fetch(url,format=markdown)`
  - `shellArgs|shellStreamArgs -> bash(command,description,workdir?,timeout?)`
  - `lsArgs -> glob(pattern="*",path)` (result reconstructed into Cursor directory tree)
  - `grepArgs -> grep(...)` or `glob` when only glob filter; result parsed back into structured grep/count/files/content forms when possible
  On resume, `sendNativeExecResult` converts tool text output back into **typed native exec result** frames; falls back if faithful conversion impossible.
- Native execs without equivalents are **rejected with typed reasons** directing model to MCP tools (avoids wasted retries). Some execs (resource/screen/computer/diagnostics/stdin spawn cases) answered with empty/error results per type; unknown logged.
- **Resilience:** dead bridge on resume -> cleanup and rebuild fresh request from history; bridge close during pending tool calls -> emit error/stop/usage and drop stale active entry; Connect end-stream error surfaced then shut down (prevents heartbeat keepalive hang). Supports streaming and non-streaming chat completion responses.

### 2.6 Notable constraints/quirks for a Relay port
- **Bun-specific:** `Bun.serve`, `Bun.spawn` (pipe reader), `Bun.sleep`, `Promise.withResolvers` patterns, `import.meta.dir`/runtime-copy assumptions.
- **Generated protobufs required:** `./proto/agent_pb` schemas (Agent/Run, GetUsableModels, KV blob, exec/mcp/native request+result types, conversation structures/checkpoints/heartbeats) are essential and must be vendored/regenerated compatibly with `@bufbuild/protobuf`.
- **Private, moving protocol:** endpoints, RPC names/paths, headers/client version string, `auto->default` mapping, blob/checkpoint semantics are reverse-engineered and subject to breakage.
- **Stateful over HTTP:** long-lived H2 stream per tool-interactive turn, cross-request continuation, disk blob/checkpoint cache needed for correctness after restarts.
- **Identity keying is simplistic:** conv/bridge keys derive from `firstUserText[:200]` (+ model for bridge) — can collide or mis-associate in some multi-session patterns; Relay should prefer explicit session/conversation IDs if possible.

---

## 3. How Relay’s provider system works (relevant to Cursor)

- **Registry & persistence:** `src/registry/{io,load,crud,types,validate,migrate}.ts` — providers stored in Relay home with `id`, `templateId`, `name`, `enabled`, `authRef`, `authType`, `api{npm,url,id,headers}`, `modelsCache`, `manualModels`, hide/test/context/kind overrides. `providerKind()` strips trailing `-N`; all provider-specific behavior must key off kind.
- **Templates:** `src/provider-templates.ts` defines addable providers (auth/authMethods, npm, base URL, `modelSource`, signup/url prompts, headers, `subscriptionRisk`, account-add support, static/manual/vertex/custom cases).
- **Auth & credentials:** `src/registry/provider-auth.ts`, `src/oauth/*`, `src/env.ts` — API keys and OAuth creds in keyring/secrets via `authRef`; native device/browser OAuth flows (OpenAI, GitHub Copilot, xAI, Claude Code, Antigravity/Cloud Code Assist, ClinePass), refresh locking & rotation safety, duplicate-account guards, subscription-risk confirmation.
- **Model refresh:** `src/registry/refresh-models.ts` + fetchers (`fetch-template-models`, `fetch-anthropic-models`, `fetch-cline-pass-models`, `fetch-commandcode-models`, Claude Code/Antigravity/Copilot/Vertex/custom paths) populate/cache models with metadata/pricing/context enrichment.
- **Materialization & catalog:** `src/registry/materialize.ts`, `src/provider-catalog.ts` convert enabled, credentialed providers to runtime `LocalProvider/LocalProviderModel` (select npm/base/endpoint/format `anthropic|openai|cloud-code`, apply compatibility/visibility/free/hidden rules). `cloud-code` is a special non-SDK endpoint path.
- **Runtime:** `src/provider-factory.ts` + `src/sdk-adapter.ts`/`openai-adapter.ts`/proxies route most providers through Vercel AI SDK (dynamic `create*` by npm, Responses vs Chat, OAuth/backends special cases, headers, refresh/retry, caching/session). Bespoke gateways exist for proprietary protocols (e.g. `src/antigravity/*` cloud-code gateway translating Cloud Code requests <-> SDK).
- **UX/surfaces:** `src/providers-command.ts`, `src/ui/api.ts` + public UI, CLI launch flows (`cli.ts`, `codex*`, `gemini*`, `claude*`, `antigravity*`), favorites/pool/server, target compatibility filtering.

**Implication:** Cursor fits Relay only as either a **new bespoke gateway-backed provider kind** (preferred, like Antigravity/cloud-code) or, as a narrower MVP, a managed local OpenAI-compatible endpoint surfaced through existing OpenAI-compatible plumbing. It does **not** fit the standard “npm + baseURL + /v1/models” template path.

---

## 4. File-by-file mapping (proposed Relay integration)

### 4.1 opencode-cursor → Relay module mapping (port targets)

| opencode-cursor file | Responsibility | Suggested Relay home | Notes |
|---|---|---|---|
| `src/proto/agent_pb*` (+ runtime assets) | Cursor protobuf/Connect schemas | `src/cursor/proto/**` (vendored/generated) | Must preserve message/field compatibility; include `h2-bridge.mjs` or replace with native Node H2. |
| `src/h2-bridge.mjs` | HTTP/2 transport workaround for Bun | `src/cursor/transport.ts` (Node `node:http2`) or `src/cursor/h2-bridge.mjs` fallback | Prefer pure Node; keep framing/timeouts/header parity (`api2.cursor.sh`, client version/type, ghost mode, unary vs connect). |
| `src/auth.ts` | PKCE params, poll, refresh, JWT expiry | `src/oauth/cursor.ts` (or `src/cursor/auth.ts`) | Reuse Relay PKCE/sleep/poll helpers where sensible; integrate with Relay refresh/rotation-safe storage. |
| `src/models.ts` | `GetUsableModels` RPC, normalize, fallback, `auto` | `src/cursor/models.ts` + `src/registry/fetch-cursor-models.ts` | Convert to `CachedModel[]`; keep `auto` semantics explicit. |
| `src/proxy.ts` | OpenAI shim + Run translation, KV blobs, exec/tool loop, checkpoints, SSE | `src/cursor/gateway.ts` / `src/cursor/proxy.ts` | Largest port: remove Bun APIs, Node HTTP server/streams, session/conversation mapping, lifecycle hooks, trace logging. |
| `src/native-tools.ts` | Native exec redirect + typed result synthesis | `src/cursor/native-tools.ts` | Keep behavior faithful; high regression risk. |
| `src/index.ts` / `src/v2.ts` | OpenCode plugin wiring | **Not used** in Relay | Logic informs UX/auth/lifecycle only. |

### 4.2 Relay files likely to add/change (MVP: experimental `cursor` OAuth + gateway)

| Area | File(s) | Purpose / change |
|---|---|---|
| Template & capability flags | `src/provider-templates.ts` | Add `cursor` template: `authType/authMethods: ['oauth']` (browser+poll), custom `modelSource` (not generic `/v1/models`), `subscriptionRisk: true`, signup/help text, `supported: true` (experimental), account-add policy. |
| Provider kind/identity | `src/registry/provider-kind.ts`, `src/registry/provider-name.ts` | Recognize `cursor` kind (and `cursor-N` if multi-account allowed); ensure kind-based comparisons everywhere. |
| OAuth flow wiring | `src/registry/provider-auth.ts`, `src/oauth/types.ts`, `src/oauth/refresh.ts`, `src/oauth/refresh-lock.ts`, `src/env.ts` | Add native Cursor OAuth path, token refresh dispatch, rotation-safe persist, revoked/reauth handling, duplicate-account identity if derivable (`providerData.identity`). |
| Credential/registry schema | `src/registry/types.ts`, `src/registry/io.ts`, `src/registry/crud.ts`, `src/registry/load.ts`, `src/registry/migrate.ts` | Persist any Cursor-specific `providerData`/auth refs; **remember:** new `RegistryProvider` fields must be whitelisted in `parseProvider` (`io.ts`) or they vanish. |
| Model refresh | `src/registry/refresh-models.ts`, (new) `src/registry/fetch-cursor-models.ts` | Resolve Cursor credential -> call discovery RPC -> cache models; handle sign-in-required/errors distinctly. |
| Materialization | `src/registry/materialize.ts`, `src/registry/model-protocol.ts`, `src/registry/provider-models.ts` | Represent Cursor runtime correctly (likely new `modelFormat`/runtime marker or managed gateway-backed OpenAI-compatible route). Do not let it flow through normal SDK baseURL assumptions. |
| Runtime routing / factory | `src/provider-factory.ts`, `src/provider-catalog.ts`, `src/provider-runtime.ts`, `src/proxy.ts` (CLI proxy), `src/server/router.ts`, `src/server/models.ts` | Route Cursor models to gateway/translator instead of generic SDK provider creation; lifecycle (start/stop/refcount/refresh) per account/session. |
| Launch/target integration | `src/cli.ts`, `src/codex*.ts`, `src/gemini*.ts`, `src/claude*.ts`, `src/antigravity*.ts`, `src/launch*.ts`, `src/target-compatibility.ts` | Decide supported targets (start with OpenAI-compatible/server/Codex paths), alias/catalog behavior, and hide/disable where incompatible. |
| Providers UX | `src/providers-command.ts`, `src/ui/api.ts`, `src/ui/public/*` | Add/auth/refresh/status UX, `subscriptionRisk` confirmation, “sign in again” states, model visibility. |
| Core API (if exposed) | `src/core/*`, `src/types.ts`, exports/build configs | Only if Cursor should be consumable via Relay core library/server contracts. |
| Docs/tests | `docs/**`, `README*`, `tests/**` | Provider doc, limitations/risk, debug flags; unit + fixture/protocol tests. |

### 4.3 Highest-risk integration points
1. **Protocol correctness** (blob IDs, checkpoint rebuild, exec resume, native result typing) — small deviations break tool use/context.
2. **Gateway lifecycle** inside Relay (on-demand start, token refresh callback, multi-turn bridge reuse, shutdown/cleanup).
3. **Conversation/session identity** mapping to Relay’s `sessionId` (current hash-from-first-message approach is brittle).
4. **Credential refresh/rotation** with Relay’s lock/re-read semantics (Cursor refresh may rotate tokens; must not clobber).
5. **Target compatibility**: OpenAI chat-completions SSE is closest match; Anthropic/native Codex/Cloud Code targets may need adaptation.

---

## 5. Ecosystem/product context (xAI × Cursor unification) — viability notes

Evidence gathered (2026 sources, summarized):

- **xAI (2026-08-26):** “Grok Bot is now included with more plans” — available for SuperGrok, Cursor Pro, and all Cursor Teams plans (also listed with SuperGrok Plus/Heavy, Cursor Pro+/Ultra); Grok Bot has separate usage. Changelog notes Pro/SuperGrok/X Premium+ linking/access work (Aug 2025-era changelog entries shown in current feed).
- **xAI (2026-10-12):** “Introducing The X Subscription” — unifies **Grok, Grok Bot, Cursor, and X Premium** in one plan with shared usage/credits and combined billing/dashboard direction (opt-in migration for existing subscribers; third-party models in Cursor billed separately on new plans per announcement details).
- **Cursor docs (current pages fetched):** Grok 4.6/4.7 documented as Cursor models available across plans/surfaces; enterprise notes state they are “served under the Cursor vendor catalog” (teams that previously blocked xAI provider can still enable). This reflects deep product integration of Grok models into Cursor’s first-party model offering.
- **Cursor community/forum signals:** mixed/rolling access experiences, BYOK xAI not generally supported as a separate provider path in some contexts, and historical demand for native Grok integration — consistent with a shifting, product-managed relationship rather than a stable third-party API contract.

**Interpretation for this project:**
- Unification **does not automatically prove** the reverse-engineered AgentService path used by opencode-cursor is dead today; it *does* mean Cursor/xAI are actively evolving auth, entitlements, model routing (“Auto”), and backend surfaces.
- The plugin’s value proposition (“use Cursor subscription in OpenCode/another agent”) is orthogonal to Cursor’s native IDE experience but depends on private infrastructure that Cursor has no incentive to stabilize for third parties.
- Alternative implementations exist and are also evolving (e.g. Nomadcxx/open-cursor via `@cursor/sdk` + proxy; magpie plugin referencing `agentn.api5.cursor.sh`/RunSSE; forks with HTTP/1.1 fallback and Node-runtime ports), suggesting ongoing protocol churn and multiple approaches — further evidence of maintenance burden.
- **Practical viability test:** a real login + `GetUsableModels` + one streaming Run (with and without tools) against current Cursor must pass before committing to implementation.

---

## 6. Recommended next steps (if pursued)

1. **Spike / go-no-go (1–2 days):** stand-alone Node script or minimal harness that (a) performs Cursor auth, (b) calls `GetUsableModels`, (c) runs a simple `AgentService/Run` chat and one tool round-trip using today’s endpoint/headers/protos. Record pass/fail and any protocol deltas.
2. **Decide scope:** MVP target surfaces (Relay server + OpenAI-compatible consumers) vs broad agent-target support.
3. **Vendor & isolate protocol code:** `src/cursor/*` module with pinned proto + transport + conformance fixtures; no Bun dependency in shipped Relay path.
4. **Ship as experimental:** template `subscriptionRisk`, explicit warnings, opt-in debug tracing, and “best effort / unofficial” docs.
5. **Defer if spike fails or churn is high:** given unification and protocol instability, cost/benefit may not justify long-term maintenance compared to officially supported providers.

## 7. Open questions / unknowns

- Do `api2.cursor.sh` auth/poll/refresh and `AgentService/{GetUsableModels,Run}` still behave as implemented after recent Grok Bot / unified-plan changes for a standard Cursor Pro account? (needs live test)
- Are there region/account/plan gates (e.g. legacy pricing, enterprise, Grok Bot-specific entitlements) that change model availability or RPC behavior?
- Exact contents/versioning of required protobuf definitions (not fetched) and how to track upstream Cursor protocol changes.
- Correct conversation/session identity mapping for Relay multi-turn/multi-session usage (current first-message hash is lossy).
- Whether Cursor exposes any sanctioned/official API surface now or planned that would replace reverse-engineering (none identified in this pass).
- Legal/ToS acceptability for Relay distribution and for end users.

---

## 8. Discovery log

- **2026-11-11:** Initial external repo analysis (README, package, v1/v2 entrypoints, auth, model discovery, proxy/bridge/native-tools), Relay architecture review (templates/registry/auth/refresh/materialize/factory/proxies/CLI), web research on Cursor+xAI unification and plugin ecosystem status, created this plan doc. `proxy.ts` tail (lines ~1573–1770) not fully inlined in fetch but behavior inferred from structure already analyzed (streaming/non-streaming handlers, resume, cleanup). No live protocol validation performed.
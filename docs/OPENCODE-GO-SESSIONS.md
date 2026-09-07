# OpenCode Go conversation sessions

OpenCode Go uses `x-opencode-session` to associate every inference request with
the conversation that produced it. Relay treats this as request metadata and
keeps it separate from provider credentials, prompts, tool arguments, and model
selection.

## Resolution and validation

Relay resolves one conversation identifier in this order:

1. An existing `x-opencode-session` header.
2. A native client session, thread, or conversation header:
   `x-claude-code-session-id`, `session-id`/`session_id`/`x-session-id`,
   `thread-id`/`thread_id`/`x-thread-id`, or
   `conversation-id`/`conversation_id`/`x-conversation-id`.
3. A `session_id`/`sessionId` field on the request `metadata`, or Claude Code's
   JSON encoded `metadata.user_id.session_id`.
4. A `session_id`/`sessionId`/`thread_id`/`threadId` field on the request body.

Because any of the step-2 headers is accepted, a `conversation-id` or `thread-id`
a client sends for an unrelated purpose becomes the forwarded session identity;
an explicit `x-opencode-session` always wins when both are present.

The value is trimmed, must contain no control characters, and is limited to
256 characters. Invalid values are dropped. Relay never forwards arbitrary
inbound headers to an upstream provider, and it does not replace a valid
explicit OpenCode header with a generated value.

When none of the sources above resolves an id, per-request surfaces (the Claude
Code proxy, `relay-ai server`, transparent proxy, Codex, Gemini, and Antigravity)
fabricate a fresh unique id for that single request. Console Go rejects any
request without `x-opencode-session` — including a client's pre-conversation
availability probe (e.g. Claude Desktop's model check) — so without this the
probe fails with HTTP 400 even though real turns (which carry a client session)
succeed. A per-request id is unique, so it never blends two conversations; it
only forgoes Go's cross-turn routing for that one session-less request.

OpenCode Go requests always include the truthful user agent
`relay-ai/<package-version>`. Static provider headers remain in place, with the
Relay user agent and resolved session header taking precedence over duplicate
case variants.

## Client and transport coverage

| Surface | Session source | OpenCode Go transport |
| --- | --- | --- |
| `relay-ai claude` and Claude Desktop | Native Claude header or request metadata | Anthropic passthrough and SDK adapter |
| `relay-ai server` | Native session/thread header or request metadata | Anthropic, OpenAI chat, and SDK adapter endpoints |
| `relay-ai codex` and Codex app | Native Codex session/thread metadata or headers | Responses HTTP/SDK adapter (the native ChatGPT WebSocket passthrough does not route OpenCode Go) |
| `relay-ai gemini` | `x-opencode-session` or a supported native session field | Gemini-to-SDK adapter |
| `relay-ai agy` / Antigravity IDE | Explicit header or the stable `agent/<conversation>/<turn>` request prefix | Cloud Code-to-SDK adapter |
| Embedded Core | `createRelayModel(..., { sessionId })` | Every AI SDK call made with the returned model |
| Transparent HTTP proxy | `x-opencode-session` and Claude's native session header | Adapter forwarding path |

Relay never invents a *process-global* fallback: that would give every
conversation on a server or embedded Core instance the same id and blend their
histories and account usage. The per-request fallback above is different — each
session-less request gets its own unique id, so two conversations can never
collide. Embedded Core is the one exception: it opts out of even the per-request
fallback, because a host can reuse one model object across conversations, which
would bake a single id into all of them. A Core host must therefore pass a
stable `sessionId` per conversation (see below).

One `relay-ai claude` launch shape is not covered: a single-model launch (no
favorites saved) of a native-Anthropic OpenCode Go model points Claude Code
straight at the upstream with no Relay proxy in between, so no session header is
injected. Launch such a model as a favorite — which routes through the catalog
proxy — to get the session header.

## Embedded Core integration

Pass one stable identifier for the lifetime of a conversation. It is safe to
reuse the model object for multiple calls in that conversation; per-call AI SDK
headers can still override the default.

```ts
const model = await createRelayModel('go::deepseek-v4-flash', {
  sessionId: conversation.id,
});
const result = await streamText({ model, prompt: 'Continue the task.' });
```

Do not use one ID for an entire daemon or process. In an Alef embedded daemon,
store the identifier on the conversation object and pass it when constructing
that conversation's model. The registry and provider credential stores remain
global; the session value is request-scoped transport metadata.

## Alef migration and certification checklist

After releasing a Relay version with this contract, update the private Alef
integration to:

1. Pass a stable per-conversation `sessionId` to `createRelayModel`.
2. Verify two concurrent conversations produce two distinct upstream headers.
3. Verify retries, streaming, tool calls, and non-streaming calls retain the
   same header.
4. Verify an explicitly supplied `x-opencode-session` wins over native aliases.
5. Verify malformed or overlong values are not sent upstream.
6. Run the same assertions against Anthropic Messages, Chat Completions, and
   Responses transports before certifying the migration.

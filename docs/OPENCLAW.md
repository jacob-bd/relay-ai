# Using Relay with OpenClaw

OpenClaw can use Relay as an OpenAI-compatible provider: any model Relay serves through `relay-ai server`,
including the **Relay Free Pool**. Tested with OpenClaw 2026.11.1 and Relay running in Docker.

## 1. Prepare Relay

1. Start the gateway: `relay-ai server`, or the container in [DOCKER.md](DOCKER.md).
2. For the pool (see [FREE_POOL.md](FREE_POOL.md)):
   ```bash
   relay-ai pool enable
   relay-ai pool status        # members must show Ready
   ```
   The gateway serves the pool only when at least one member has a passing **Test for Claude**
   (`targets` includes `claude`). Members showing "Needs test" are not served. Re-test them in the UI or
   with `relay-ai pool verify`.
3. Check the endpoint: `GET http://<host>:17645/openai/v1/models` lists `relay-free-pool` once the pool is
   ready.

## 2. Authentication

- **Local mode** (`relay-ai server` on the same machine, no password): any non-empty `apiKey` works.
- **Network mode / Docker**: `apiKey` must be the gateway password (`RELAY_AI_SERVER_PASSWORD`). Relay
  answers anything else with `401 Unauthorized`. The password is sent as `Authorization: Bearer <password>`.

## 3. OpenClaw configuration (`~/.openclaw/openclaw.json`)

```json5
"models": {
  "providers": {
    "relay-ai": {
      "baseUrl": "http://127.0.0.1:17645/openai/v1",   // your Relay host/port
      "apiKey": "<gateway password, or any non-empty string in local mode>",
      "api": "openai-completions",
      "models": [
        {
          "id": "relay-free-pool",
          "name": "Relay Free Pool",
          "reasoning": false,          // see "Reasoning effort" below
          "input": ["text"],
          "contextWindow": 128000,     // see "Context window" below
          "maxTokens": 8192
        }
      ]
    }
  }
},
"agents": {
  "defaults": {
    "models": { "relay-ai/relay-free-pool": { "alias": "relay-free-pool" } }
  }
}
```

Other Relay models appear as `/openai/v1/models` ids. When two providers share a bare id, Relay exposes it
as `<providerId>/<id>`.

## 4. Context window

Relay advertises the pool at its **largest** member's window minus a 10% reserve. OpenClaw plans
compaction from the `contextWindow` you declare, so set it yourself.

For each request Relay checks every member separately: it skips a member (without counting a failure)
when

```
estimated prompt tokens + output reserve + margin  >  member's context window
margin = max(4096, 10% of the window)
```

Two things make this stricter than "window minus 10%":

- The output reserve is part of the sum (the request's `max_tokens`, capped per model; 32,768 when none is
  sent).
- The prompt estimate is deliberately conservative: UTF-8 bytes ÷ 2, roughly double the real token count
  for English text. A 128K member can therefore be skipped well before OpenClaw sees 128K real tokens
  (our rough estimate: somewhere around 40–70K real tokens). This is a calculation from the code, not a
  measurement.

If every member is skipped or ineligible, the request fails with `No eligible free pool members: …`
followed by the reason for each member.

Practical guidance:

- Setting `contextWindow` to the smallest member's window keeps OpenClaw compacting at a size every
  member can accept, but it does **not** guarantee the top-priority member is never skipped, for the reason
  above. Setting it lower makes that rarer.
- A value larger than a member's window (for example 200000 with a 128K member in the pool) means that
  member is passed over once the conversation grows, and only larger members answer.
- `relay-ai pool status` lists each member's window.

## 5. Reasoning effort

On the OpenAI Chat Completions endpoint, **Relay does not forward any reasoning level**, from either side:

- A `reasoning_effort` (or similar) value sent by OpenClaw is removed before the request reaches a member.
- `relay-ai pool effort auto|low|medium|high` has no effect on this endpoint. It applies to the Claude,
  Codex and Antigravity launchers.

Each member runs on its provider's default. So `pool verify --reasoning` and the pool effort setting do not
change behavior for OpenClaw.

Choose `"reasoning"` for the model entry based on what you want OpenClaw to do:

- `false` (recommended): OpenClaw sends no reasoning parameters and does not show thinking controls for
  this model.
- `true`: OpenClaw shows and sends its thinking level, and Relay discards it.

OpenClaw's default `thinkingDefault: "adaptive"` is mapped to the model's default level; it is not an
effort that reaches the provider.

## 6. Troubleshooting

| Symptom | Cause |
| --- | --- |
| `401 Unauthorized` | `apiKey` is not the gateway password (network mode / Docker). |
| `relay-free-pool` missing from `/openai/v1/models` | Pool disabled, empty, or no member has a passing Test for Claude. Run `relay-ai pool status`. |
| `No eligible free pool members` | Every member was skipped (prompt too large for its window), is cooling down, disabled, or needs a Test. The message lists each reason. |
| Provider default reasoning only | Expected; see section 5. |

## Known gap

[FREE_POOL.md](FREE_POOL.md) says the pool effort setting applies when a tool sends no level. That holds
for the launchers, but the gateway's OpenAI route always runs the pool with effort `auto` and removes
client effort values (`src/core/pool-model.ts`). Either that route should honor the setting or the docs
should say it does not.

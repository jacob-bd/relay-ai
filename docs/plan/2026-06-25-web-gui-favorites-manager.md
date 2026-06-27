# Web GUI — Favorites Manager (v1)

A browser-based settings panel for Relay AI, opened via `relay-ai ui`. Manages API keys and favorite models with a premium, high-polish dark interface.

**Scope for v1:** Provider key management + favorites reorder/add. Nothing else.

---

## Security Model

Bind to `127.0.0.1` only. No token required — loopback binding is the security boundary.

---

## Dependencies

- `open` npm package — cross-platform browser launch. Graceful fallback on Linux headless: print the URL to stdout.

---

## Resolved Decisions

| Question | Decision |
|---|---|
| Vanilla JS or Preact/HTM? | **Vanilla JS** — 3 views, 5 state values, native DnD API. No framework needed. |
| Foreground or auto-shutdown? | **Foreground + Ctrl+C** — consistent with developer mental model. Print URL on start. |
| Theme | **Dark only** — terminal-native developer audience. |

---

## Implementation

---

### 1. CLI — `src/ui-command.ts` (new)

- Binds HTTP server to `127.0.0.1` on a random available port (retry on bind failure).
- Lock file at `~/.relay-ai/ui.lock` (PID + port). If the process is alive on a second launch, print the existing URL and exit — no second server.
- Cleans up lock file on exit, SIGINT, SIGTERM.
- Calls `open(url)`, falls back to printing the URL if it throws.
- Startup message:
  ```
    relay-ai UI  http://127.0.0.1:PORT
    Press Ctrl+C to stop
  ```

### 2. CLI Router — `src/cli.ts` (modify)

- Add `ui` subcommand wired to `src/ui-command.ts`.

---

### 3. API — `src/ui/api.ts` (new)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/config` | Returns preferences + `{ hasKey: boolean }` per provider. **Never exposes key values.** |
| `POST` | `/api/config` | `Partial<UserPreferences>` → `savePreferences()`. |
| `GET` | `/api/models` | `fetchProviderCatalog()` with 30s timeout → 504 on timeout. Reuses existing 1-hour cache — no subprocess spawn if cache is fresh. |
| `POST` | `/api/providers/refresh` | Forces a catalog refresh for one provider to validate a newly entered key. Returns `{ ok: true, count: 42 }` or `{ ok: false, error: string }`. |
| `POST` | `/api/keys` | Trim + validate input, then write to OS credential store. Returns structured error when keychain unavailable (Linux headless). |

---

### 4. Build Fix — `package.json`

`tsup` does not copy static files. Required:
1. Add `cp -r src/ui/public dist/ui/public` to the build script.
2. Add `"dist/ui/public"` to `package.json` `files`.
3. Resolve the `public/` path relative to `import.meta.url` — not a hardcoded string — so global installs work.

---

### 5. Frontend — `src/ui/public/`

Three files: `index.html`, `app.js`, `style.css`. Vanilla JS, no build step.

---

#### Design Language

**Color strategy:** Committed. One saturated cool-indigo accent on dark tinted neutrals (OKLCH throughout — no `#000` or `#fff`).

**Palette:**

| Role | OKLCH | Usage |
|---|---|---|
| Surface base | `oklch(11% 0.01 265)` | Page background |
| Surface raised | `oklch(14% 0.012 265)` | Section bg, inputs |
| Surface hover | `oklch(17% 0.014 265)` | Row hover |
| Border subtle | `oklch(22% 0.015 265)` | Dividers |
| Border active | `oklch(35% 0.02 265)` | Focused input |
| Accent | `oklch(68% 0.22 265)` | Actions, drag handle, active nav |
| Text primary | `oklch(94% 0.005 265)` | Labels, headings |
| Text secondary | `oklch(62% 0.01 265)` | Descriptions, hints |
| Text muted | `oklch(40% 0.008 265)` | Placeholders |
| Success | `oklch(72% 0.18 155)` | Key valid, saved |
| Error | `oklch(65% 0.22 25)` | Errors |

**Typography:** `'Inter', system-ui, -apple-system, sans-serif`

| Level | Size | Weight |
|---|---|---|
| Section heading | 11px | 600, all-caps, 0.08em tracking |
| Item label | 14px | 500 |
| Body / hint | 13px | 400 |
| Mono (model IDs) | 12px | 400 |

**Layout:** Single scrolling page. Sticky header with three anchor-link tabs. Max-width 720px centered. No card grids. Lists with subtle separators. Varied section padding for rhythm.

**Motion:** `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-quint) on all interactions. Only `transform` and `opacity` — never layout properties.

| Interaction | Animation |
|---|---|
| Row hover | `background-color` 120ms + `translateX(2px)` |
| Input focus | Border brightens + faint outer glow 200ms |
| Drag grab | `scale(1.02)` + shadow lift 200ms; siblings `opacity: 0.5` |
| Drag over gap | Adjacent items `translateY(±30px)` 200ms to open drop zone |
| Drag release | Settle to rest 350ms |
| Toast in | `translateY(8px→0)` + `opacity(0→1)` 200ms |
| Toast out | `translateY(0→-4px)` + `opacity(0)` 150ms |
| Skeleton shimmer | Linear sweep 1.4s infinite |
| Nav tab activate | Accent underline slides in 200ms |

---

#### View Breakdown

**Header (sticky)**
```
relay-ai          [Providers & Keys]  [Favorites]  [Antigravity]
```
- Pill tabs, anchor-linked. Active tab: accent fill. Scroll-activated backdrop blur.

---

**View 1 — Providers & Keys**

- **Search bar** at top: filter-as-you-type across all configured providers by name.
- Each provider = one row: name (500 weight) + status chip ("Key stored" in success / "Not configured" in muted).
- Clicking a row expands an inline input (height animates open, no modal).
  - Existing key: shows `••••••••` placeholder + "Change" button. "Change" clears the field for retype.
  - New key: blank input.
- **"Test & Refresh" button** next to the input — calls `POST /api/providers/refresh`.
  - Success: `✓ Key valid · 42 models available` in success color, fades after 4s.
  - Error: inline red message with the specific reason.
- Auto-saves to keychain on blur. Shows "Saved" confirmation inline for 2s.
- Linux headless: muted note "Secure storage unavailable — key saved to session only."

---

**View 2 — Favorites (General)**

Used by Claude, Codex, and Gemini CLIs. Up to 20 models (`MAX_MODEL_CATALOG`).

**Adding:**
- Search input at top of section: filter-as-you-type across the full model catalog (loaded from `GET /api/models`).
- Results grouped by provider. Each row shows: model ID (mono) + provider name + context window if available. No placeholder stats.
- While loading: 5-row skeleton shimmer.
- Timeout / error: "Could not load models." + Retry button.
- `+` button on each result adds to the favorites list with a slide-in animation. Button becomes a checkmark (`✓`) if already in favorites.

**Reordering:**
- Drag handle (⠿) on the left of each row. Only the handle initiates drag.
- Keyboard: focus a row → `Alt+↑` / `Alt+↓` to move.
- Auto-saves on drag-end. "Saved" toast (bottom-right, 2s) with an "Undo" text button for 4s.
- Empty state: "No favorites yet. Search above to add your first."

---

**View 3 — Antigravity Favorites**

Used exclusively by `relay-ai antigravity`. Hard cap of **6 models** (the user selects 1 starting model at launch; together they fill 7 slots, the validated route limit).

Identical add + reorder interaction as View 2, with two differences:

1. **Slot counter** in the section heading: `ANTIGRAVITY FAVORITES  3/6`
   - Counter updates live as models are added/removed.
   - When 6/6: the `+` button on search results is disabled and grayed. Tooltip: "Remove a favorite to add another."
2. **Capacity enforcement:** The `+` button is hidden (not just disabled) for models already in the list, and disabled at capacity.

---

#### Page Chrome

- `<title>`: `relay-ai settings`
- Favicon: inline `data:` URI, simple "R" lettermark on transparent background.
- Focus rings: `outline: 2px solid oklch(68% 0.22 265); outline-offset: 2px` — no browser default.
- Max-width: 720px, centered.

---

## Verification

### Automated Tests — `tests/ui-api.test.ts`

- Server lifecycle: start in `beforeAll`, stop in `afterAll`.
- `GET /api/config`: assert `hasKey: boolean` shape — no key values present.
- `GET /api/models`: assert 504 when catalog times out (mock delayed `fetchProviderCatalog`).
- `POST /api/providers/refresh`: mock successful fetch → assert `{ ok: true, count: 42 }`.
- `POST /api/keys`: assert empty string returns 400; assert whitespace is trimmed.
- Keychain calls mocked — CI has no OS credential store.

### Manual Checklist

1. `npm run build && relay-ai ui` — URL prints, browser opens.
2. **Provider search**: type a provider name, confirm filtering works instantly.
3. **Key + Test**: enter a key, click "Test & Refresh" — verify model count appears.
4. **General Favorites**: search a model, add it, drag to reorder, verify `~/.relay-ai/config.json` → `favoriteModels` reflects new order after Ctrl+C.
5. **Antigravity Favorites**: add models up to 6, verify the `+` button disables at capacity and the counter shows `6/6`.
6. **Keyboard reordering**: tab to a favorite row, `Alt+↑` — verify it moves up.
7. **Double-launch**: run `relay-ai ui` a second time — verify it prints the existing URL without starting a second server.
8. **Linux/WSL**: verify the URL prints to stdout when `open` fails.

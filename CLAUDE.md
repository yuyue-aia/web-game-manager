# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
cp .env.example .env       # then fill in GOSUND_PLUG_TOKEN + GOSUND_PLUG_IP at minimum

npm run typecheck          # tsc --noEmit — the only static check in the project
npm run web                # foreground dev run (tsx src/web/start-web.ts)

# background service (writes .run/web.pid + .run/web.log)
npm run web:daemon
npm run web:status
npm run web:logs           # tail -f
npm run web:stop
```

There is no test runner, linter, or build step configured. TypeScript is executed directly via `tsx`; `tsc` is only used for type-checking (`outDir: dist` is declared but unused). Runtime state and user data live under `.runtime/`; do not delete these files casually — `web-users.json` holds account credentials (scrypt-hashed).

The daemon script (`scripts/web-service.sh`) refuses to stop a process it does not own — it verifies `command` contains `src/web/start-web.ts` and `cwd` matches the repo root before killing. If `.run/web.pid` is missing it falls back to `lsof` on `WEB_PORT` (default 8787).

## Architecture

Single Node.js process serving an SPA plus a JSON API. Zero HTTP framework: `node:http` + hand-rolled routing/static serving in `src/web/http-utils.ts` and `web-server.ts`. Zero runtime deps other than `dotenv`. TypeScript is CommonJS + NodeNext.

### Startup and lifecycle

`src/web/start-web.ts` is the sole entry point:

1. Loads `.env` (must happen before any service import — the plug controller reads `GOSUND_PLUG_*` at construction time).
2. Instantiates the `GameConsoleController` singleton and calls `recoverActiveSession()` — if a game/TV session was mid-flight when the previous process died, timers and the auto-cut-power hook are re-attached from the persisted quota state.
3. Starts `WebServer`, which wires `UsersStore` + `GameConfigStore` + the controller singleton together, applies the persisted runtime config to the controller, and installs an announcer callback whose only side-effect is stashing the latest non-reminder announcement in `pendingAnnounce` so the SPA can poll it via `/api/game/status`. `'reminder'` announcements are intentionally dropped server-side because the SPA speaks countdown reminders locally.

### The controller is the fan-in point

`src/services/game-console-controller.ts` composes the domain layer and is a singleton shared by every entry point that will ever exist (web routes, future voice/agent integration, cron-like schedulers). Everything below it is stateless-ish and driven by config + persisted JSON files under `.runtime/`:

- `game-quota.ts` — per-child daily quota bookkeeping, `.runtime/game-quota.json`.
- `game-session-timer.ts` — schedules reminders + hard cutoff for an active session.
- `plug/gosund-plug-client.ts` — MiIO protocol client for the Gosund `cuco.plug.cp5d` power strip; addressed by MAC/name first, IP as fallback. Multiple sockets on the same physical strip: `s3` = TV, `s4` = console. Playing games requires both (TV acts as monitor); watching TV needs only `s3`. `GAME_PLUG_DIDS` and `TV_PLUG_DIDS` encode this and are validated against `SWITCH_SIID_BY_DID` at load time — fail-fast on typos.
- `tv-safe-shutdown.ts` + `tuya-ir-client.ts` — power-off flow is **IR standby command → poll Hisense UPnP until it reports standby → cool-down delay → cut socket power**, never a naive plug-off (would corrupt the TV).
- `auto-charge-scheduler.ts` — turns on the console socket during a nightly window so the controller's battery does not fully drain; state in `.runtime/auto-charge-state.json`.
- `ipad-access-scheduler.ts` + `netgear-*.ts` — schedules device internet cut-off via the Netgear/Orbi router's access-control API, resolving devices by MAC/name against a cached device list.

The scattered `.runtime/*.json` files are all written with tmp-file + rename for atomicity — follow that pattern for any new persisted state.

### Web layer conventions

- Routes are dispatched by a big switch in `web-server.ts` on `${method} ${pathname}`. There is no router library; add new endpoints there.
- Auth: session cookie `ha_sess` (HttpOnly + SameSite=Strict), 7-day TTL. Sessions live in memory only — a restart logs everyone out (accepted trade-off). `UsersStore` also rate-limits failed logins per IP.
- CSRF strategy: SameSite=Strict + writes require `Content-Type: application/json`. Do not accept form-encoded bodies for mutations.
- Three roles: `admin`, `member`, `test`. Cloud credentials (Tuya/Gosund tokens) never leave the server — do not add endpoints that echo `.env` values to the client.
- The SPA is a single file: `public/app/index.html`. `serveStatic` in `http-utils.ts` handles it; there is no build pipeline for the frontend.

### Env config is the API

Almost all behaviour (quotas, allowed weekdays, reminder offsets, plug DIDs, TV shutdown timings, auto-charge window, router URL) is configured via `.env`; `.env.example` is the source of truth for available knobs and their semantics. `GameConfigStore` (`src/web/config-store.ts`) additionally persists runtime-editable overrides in `.runtime/game-config.json` and pushes them into the controller via `applyRuntimeConfig`; env values are only the boot defaults.

### What this project is not

Per the README, this is the **web-only** split. It has no LLM, ASR/TTS, wake-word, music, reminders, web search, or A/C control code. If a task mentions any of those, it belongs in the sibling `apps/agent-game-manager/` project, not here.

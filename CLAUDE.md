@AGENTS.md

# CraftAttack Tracker – notes for coding agents

The README (German) is the reference for pages, captured events, env vars and tables. This file is the short map
and the rules that are easy to get wrong. UI text, code comments and commit messages are German; keep it that way.

## Architecture in one paragraph

One Next.js 16 app (`cacheComponents`, PPR, React 19, `pg`), started in one of three modes via `TRACKER_MODE`
(`lib/mode.ts`, enforced in `proxy.ts`): `tracker` polls craftattack.one + Twitch and WRITES the DB, `web` only
READS the DB and renders pages, `all` does both (local dev). The tracker keeps the full state in memory
(`lib/store.ts`: `getState()`, events capped at 20 000 except the rare types in `KEEP_IN_MEMORY`) and persists to
Postgres; tables are created/migrated at startup in `lib/db.ts` (`ADD COLUMN IF NOT EXISTS`, never destructive).
Expensive analyses are precomputed by the tracker every ~10 min into table `snapshots` (`lib/snapshotJobs.ts`,
`lib/snapshots.ts`) and only read by the website; smaller expensive queries use `lib/swrCache.ts`
(single-flight + stale-while-revalidate). In production `scripts/cached-server.mjs` sits in front of the web build
(page cache, max 2 concurrent renders, zero-downtime version switch on SIGUSR2).

## Where things live

| Concern | Files |
| --- | --- |
| Polling, diffing API states into events, AFK/farm detection | `lib/tracker.ts`, `lib/craftattackFetch.ts`, `lib/backfill.ts` |
| Event types, labels, feed thresholds | `lib/types.ts`, `lib/events.ts`, `lib/extraEvents.ts`, `lib/feedThresholds.ts` |
| Twitch API / IRC / VOD+clip history | `lib/twitch.ts`, `lib/twitchIrc.ts`, `lib/twitchHistory.ts`, `scripts/vod-chat.mjs` |
| YouTube uploads (Data API v3, `YOUTUBE_API_KEY`, tracker only; channel list = only self-linked channels, no fan channels) → event `youtube_upload` (`where: "youtube"`), profile section | `lib/youtube.ts`, `lib/youtubeChannels.ts`, `lib/youtubeStats.ts` |
| „Gemeinsam streamen“ (Stream Together, via Twitch-Web-GQL) | `lib/costream.ts` → `costream_sessions`, `twitch_clips.costream_*` |
| Page data entry point | `lib/data.ts` → `loadTracker()` (calls `connection()`, so request-only) |
| Day boundaries (Europe/Berlin) | `lib/berlin.ts`, `dayKey` in `lib/analytics.ts` |
| Big analyses | `lib/analytics.ts`, `lib/viewerMigration.ts`, `lib/viewerFlowCore.ts`, `lib/network.ts`, `lib/groups.ts`, `lib/rhythmCore.ts` |
| Startup jobs (warm caches, official events, heads/skins, Twitch history) | `instrumentation.ts` |
| Event detail page `/ereignis/<id>`, raid analysis `/raids` | `app/ereignis/[id]`, `app/raids`, `components/detail/`, `lib/eventDetail.ts` (`statOf()`: new event types need an entry or get no chart), `lib/eventPair.ts`, `lib/raidAnalysis.ts` |
| Player comparison `/vergleich?a=<id>&b=<id>` (tab under Spieler; links via `compareHref()` from profile, Verbindungen, Zuschauer, Graph, event detail) | `app/vergleich/`, `lib/playerCompare.ts`, shared third parties `lib/thirdParties.ts` (audience overlap precomputed as snapshot `audience-overlap:server`), `lib/compareHref.ts` |
| Hidden test pages (`/vorschau/<key>/…`, key in `~/.config/actracker/vorschau.key`) | `app/vorschau/[key]/` with `previewGate()` from `lib/preview.ts` – try new features here before going public; `/vorschau/<key>/gesichter` (face labeling), `/vorschau/<key>/voicechat` (voice group stats) and `/vorschau/<key>/chat` (in-game chat cleanup, OCR names → players) for the recap-video VOD scan (`lib/faceReview.ts`, `lib/voiceSummary.ts`, `lib/chatReview.ts`, files in `FACE_REVIEW_DIR`, default `~/craftattack-stats/review`) |
| Ops scripts | `scripts/deploy.sh`, `scripts/autodeploy.sh` (push to main → live), `scripts/cached-server.mjs`, `scripts/watchdog.mjs`, `scripts/heap-report.mjs` (heap via IPC), `scripts/memtest.mjs` (memory test), `scripts/backup.sh` (+ `RESTORE.md`), `scripts/systemd/` |
| Dormant estimate mode (`/schaetzung`, `CA_ESTIMATE=1`) | `lib/estimateMode.ts`, `scripts/estimate.mjs` – shut down, kept for reuse |

## Rules that bite

- Background code (tracker jobs, snapshot jobs, anything started from `instrumentation.ts`) must use `getState()`,
  never `loadTracker()` / `connection()`; those only work inside a request.
- The website must not fetch craftattack.one itself; only the tracker does (official events, heads and skins are
  copied into the DB). Respect the backoff in `lib/craftattackFetch.ts`; never add workarounds for blocks.
- Memory is tight (`--max-old-space-size=280`): don't load whole tables per request. Precompute into `snapshots`
  or wrap in `createSwrCache`, and keep new in-memory series compact.
- Every module-level cache (Map, object, array that outlives a request) needs an upper bound: a fixed key set, or
  size/idle eviction. `createSwrCache` evicts by itself (48 entries, 30 min unread); a hand-rolled `new Map()` keyed by
  player, URL, time range or query param does not, and filled the heap until the site crashed (22.11.2026, PR #188).
  `WeakMap` keyed by a per-request object caches nothing.
- Production guard: `scripts/cached-server.mjs` restarts Next.js without downtime when the heap stays above 85 % for
  2 min; `scripts/watchdog.mjs` pushes a warning on repeated restarts or an out-of-memory crash. That hides a leak
  from visitors, it does not fix it.
- Changes to AFK detection: bump `AFK_HISTORY_VERSION` in `lib/backfill.ts` so events are rebuilt from history,
  and test the rebuild on a copy of the DB first.
- Adding columns to `player_history.extra_stats` = append to the order in `lib/playerStats.ts`, never reorder.
- New cookies, browser storage keys or third-party requests → update `cookie.md` (basis for the privacy policy).
- Data never invented: VOD/IRC gap filling only records what was actually observed.

## Verify before a PR

```bash
npm ci                      # in a fresh worktree; symlinked node_modules break Turbopack
rm -rf .next*/types && npx next typegen
npx tsc --noEmit            # any error blocks the merge
npm run lint
# Touches pages, lib/ or caches: memory test against a production build (~10 min, see header of the script)
npx next build && DATABASE_URL=… node scripts/memtest.mjs   # exit 1 = heap budget exceeded or grows per round
```

Running locally needs only `DATABASE_URL` (add `?sslmode=disable` for a local Postgres without TLS). Check UI
changes visually in a browser, not just by type-checking.

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
| Page data entry point | `lib/data.ts` → `loadTracker()` (calls `connection()`, so request-only) |
| Day boundaries (Europe/Berlin) | `lib/berlin.ts`, `dayKey` in `lib/analytics.ts` |
| Big analyses | `lib/analytics.ts`, `lib/viewerMigration.ts`, `lib/viewerFlowCore.ts`, `lib/network.ts`, `lib/groups.ts`, `lib/rhythmCore.ts` |
| Startup jobs (warm caches, official events, heads/skins, Twitch history) | `instrumentation.ts` |
| Ops scripts | `scripts/deploy.sh`, `scripts/cached-server.mjs`, `scripts/watchdog.mjs`, `scripts/backup.sh` (+ `RESTORE.md`), `scripts/systemd/` |
| Dormant estimate mode (`/schaetzung`, `CA_ESTIMATE=1`) | `lib/estimateMode.ts`, `scripts/estimate.mjs` – shut down, kept for reuse |

## Rules that bite

- Background code (tracker jobs, snapshot jobs, anything started from `instrumentation.ts`) must use `getState()`,
  never `loadTracker()` / `connection()`; those only work inside a request.
- The website must not fetch craftattack.one itself; only the tracker does (official events, heads and skins are
  copied into the DB). Respect the backoff in `lib/craftattackFetch.ts`; never add workarounds for blocks.
- Memory is tight (`--max-old-space-size=280`): don't load whole tables per request. Precompute into `snapshots`
  or wrap in `createSwrCache`, and keep new in-memory series compact.
- Changes to AFK detection: bump `AFK_HISTORY_VERSION` in `lib/backfill.ts` so events are rebuilt from history,
  and test the rebuild on a copy of the DB first.
- Adding columns to `player_history.extra_stats` = append to the order in `lib/playerStats.ts`, never reorder.
- User-visible change (new page, feature, data fix visitors notice) → add an entry at the top of `CHANGES` in
  `lib/changelog.ts` (German, visitor's point of view, `at` = when it goes live, PR number). Internal work stays out.
- Data never invented: VOD/IRC gap filling only records what was actually observed.

## Verify before a PR

```bash
npm ci                      # in a fresh worktree; symlinked node_modules break Turbopack
rm -rf .next*/types && npx next typegen
npx tsc --noEmit            # any error blocks the merge
npm run lint
```

Running locally needs only `DATABASE_URL` (add `?sslmode=disable` for a local Postgres without TLS). Check UI
changes visually in a browser, not just by type-checking.

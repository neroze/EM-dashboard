# Capacity Radar

One view of every leave request in your reporting line — **Draft** (requested,
awaiting approval) and **Planned** (approved) — sourced from BambooHR, with
filters, a calendar, a list, sprint capacity, and overlap alerts. Read-only:
approvals stay in BambooHR. A native macOS app on tinyjs. No server: it calls
BambooHR directly with your own API key.

```sh
npm install
tinyjs dev            # hot reload
npm test              # unit tests (mappers, status, org tree, capacity, export)
npm run typecheck
tinyjs build          # dist/Capacity Radar.app (ad-hoc signed, ~10 MB)
                      # --universal for one app on Apple Silicon + Intel
```

First launch asks for your company domain and a personal BambooHR API key
(stored in the Keychain only). **Try with demo data** runs the whole pipeline
on synthetic people ("Demo Person NN") without a key.

## Layout

The tinyjs Vite template puts the backend in `backend/` and the UI in `src/`
(the spec's `src/` and `web/src/` respectively):

```
backend/main.ts            api object (setup, getStatus, syncNow, getLeave, getCalendar,
                           getCapacity, getOverlaps, getSummary, getLookups, saved views,
                           exportCsv/exportXlsx, settings, digest, getResourceUsage, signOut)
backend/bamboo/client.ts   HTTP client: Basic auth, 429/503 backoff 1-2-4-8 s, 5 tries, no key/body logging
backend/bamboo/mappers.ts  BambooHR JSON -> records (notes, balances, contacts never kept)
backend/bamboo/demo.ts     fake client for demo mode
backend/sync/scheduler.ts  launch + every-15-min sync, never overlapping
backend/sync/orgTree.ts    reports-to tree, my subtree
backend/db/schema.ts       SQLite schema   backend/db/repo.ts  queries
backend/domain/            status, capacity/overlap, dates, sort, export (CSV + .xlsx), resources
backend/queries.ts         read side for every view
backend/domain/release.ts  release readiness metrics (one LP "Release Activity" epic's children)
backend/releases.ts        hand-picked planning dates per release epic (<data>/releases.json)
backend/secrets.ts         Keychain (tinyjs app.secrets)
resources/config/          sprints.json (Sprint Mapping - Webx), squads.json, holidays.json
src/                       React UI: views/, components/, state/filters.ts, api.ts
test/                      node:test + anonymised fixtures
```

Edited config lives in `~/Library/Application Support/<id>/config/` and wins
over the bundled copy. Squads are edited in **Settings → Squads**.

## Things to verify against your tenant

These came from the BambooHR docs or from memory, and are marked `verify` in the code:

- `POST reports/custom` with `supervisorEId` as the manager's employee id
  (falls back to `employees/directory`, which has no manager ids, so scoping
  would come up empty).
- `GET employees/0` returns the key owner's employee.
- The deep-link path (`/employees/pto/?id=`). You can change it in Settings.
- Whether hour-based requests convert at 8 h/day (Settings → Hours per day).

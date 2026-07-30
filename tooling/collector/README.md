# @home/collector

Pipeline 2. A Bun script that reads this Mac's agent-session directories, works
out how many sessions ran and roughly how long they lasted, and pushes **only
those numbers** to the site.

```sh
cd tooling/collector

bun run collect          # dry run — scan, aggregate, print. No network.
bun run collect:push     # the same, then POST /ingest/ai-usage
bun run inventory        # LOCAL: which repo directories exist and how they map
bun test                 # the privacy tests
```

`bun run collect -- --help` lists every flag.

---

## What leaves the machine

Exactly this, and the JSON below is the whole payload — there is no envelope, no
client version, no hostname, no run id:

```jsonc
{
  "days": [
    {
      "day": "2026-07-30",        // UTC calendar day
      "agent": "codex",           // 'claude' | 'codex'
      "sessions": 12,             // the day's total for that agent
      "hours": 6.4,               // estimated, fractional
      "projects": [               // the per-project breakdown
        { "projectSlug": "quotecloud", "sessions": 9, "hours": 5.1 }
      ]
    }
  ],
  "postedAt": "2026-07-31T09:20:04.117Z"
}
```

Six kinds of value: a date, an agent id, a slug, two counts and an instant. No
prompts, no code, no file contents, no filenames, no directory names, no paths.

### How that is enforced rather than promised

Three mechanisms, in the order the data hits them.

**1. The scanners cannot hold content.** They produce `SessionSample`
(`sessions.ts`), which has four fields: an agent, an instant, a number of hours,
and a local-only path token. There is nowhere on that type to put a message.

- `scan-claude.ts` never parses a transcript line. It streams the file and
  applies one regular expression that matches an ISO instant in a `"timestamp"`
  field. The only values that survive into a variable are `Date` objects.
- `scan-codex.ts` reads **line 1 and stops** — `readFirstLine` cancels the
  stream at the first newline. The `~/.codex/sessions` store is 5.4 GB; lines 2
  onward are never read off the disk at all. Line 1 is the `session_meta`
  record, and two fields are taken from it structurally (`timestamp`,
  `payload.cwd`) rather than by regex, precisely because line 1 also contains the
  full system prompt and a regex for `"cwd"` would happily match a path
  *mentioned* in that prose.

**2. `payload.ts` is the only place an outgoing object is constructed**, and the
path token is read exactly once there, by `resolveSlug`, which returns a
configured slug or `null`. A repo with no mapping resolves to `null`, is counted
in the day's totals — which are integers — and is attributed to nothing. Its
name has nowhere to go.

**3. The wire schema is strict.** `AiUsageIngestSchema` in `packages/types` is a
Zod `strictObject` at every level, and `buildPayload` parses through it before
returning. A future edit that adds `cwd`, `hostname` or `notes` to the payload
throws at build time instead of shipping a new field. That is why the schema has
no free-form fields and must not gain any.

**The tests are the verification plan's own clause**, executed. `bun test`
builds payloads from fixtures whose prompts contain absolute paths, fake API
keys, filenames and marker strings, then asserts:

- every key in the serialised payload is one of eight allowed names;
- every string in it is a date, an agent id, or a slug from the config;
- everything else is a finite, non-negative number;
- the bytes contain no `/`, no `\`, no `users`, and none of the markers;
- the dry-run summary — which gets printed to a log file — is aggregate-only too;
- a smuggled field is rejected by the schema rather than silently stripped.

Nothing in the test file reads `~/.claude` or `~/.codex`. A test that only
passes on one laptop is not a test.

---

## The repo → slug mapping

`collector.config.json` holds the map from a local checkout directory to a
public `projects.slug` / `labs.slug`:

```jsonc
"repos": [
  { "dir": "personal-site",  "slug": "home" },
  { "dir": "client-app-v2",  "slug": "quotecloud" }   // `dir` invented here
]
```

> **`collector.config.json` is gitignored.** Copy `collector.config.example.json`
> to it on first use. The left-hand side of every entry is a *private repository
> directory name* and this monorepo is a public repo, so committing the real
> mapping would publish the inventory this funnel exists to withhold (ADR 008).
> Every `dir` shown in this README is invented for the same reason.

Matching is **segment-wise containment, longest match first**. One entry
therefore covers the repo root, every package inside it, and every agent
worktree cut from it:

```
-Users-…-GitHub-client-app-v2                       ✓
-Users-…-GitHub-client-app-v2-packages-convex       ✓
-Users-…-GitHub-client-app-v2-.claude-worktrees-…   ✓   (two encodings exist —
-Users-…-GitHub-client-app-v2--claude-worktrees-…   ✓    both are handled)
-Users-…-.codex-worktrees-3a1a-client-app-v2        ✓
-opt-homebrew-lib                                   ✗   (segments, not substrings)
```

To find out what is on this machine and what it currently maps to:

```sh
bun run inventory        # add --days 60 to look further back
```

**That command prints private repository directory names.** It is the only one
that does, it prints them to your terminal and nowhere else, and it exists
because writing the mapping requires seeing the list. Everything else in this
package treats those names as radioactive.

An unmapped directory is not an error. Its sessions count toward the day totals
that feed the homepage AI signal — the work happened — and simply have no
project to be attributed to.

### Deliberate simplification: the mapping is a local file — and stays local

The plan says "map repo → project slug via **admin config**". This
implementation keeps the mapping in `collector.config.json` instead, and does
not commit it. That is a considered divergence, not an oversight:

1. The left-hand side of every entry is a **private repo directory name**. Admin
   config lives in Convex, which is the server. Storing the mapping there means
   uploading exactly the strings ADR 008 exists to keep local — the server would
   have to learn every repo name on this Mac in order to help the collector
   avoid telling it any repo name.
2. The mapping is machine-specific: it describes where *this* laptop keeps its
   checkouts. A second machine needs a different one.
3. It changes when a repo is cloned, which is roughly never.

Reasons 1 and 2 are also why the file is **gitignored** and
`collector.config.example.json` is committed in its place. A committed mapping
would put every client checkout directory name into a public repository — the
same disclosure the funnel blocks at run time, only permanent and indexable.

The cost is that adding a mapping needs a text editor rather than the admin UI,
and that a fresh clone starts with `cp collector.config.example.json
collector.config.json`. That is the entire cost.

### Slugs with no local checkout

Some seeded slugs have no matching directory on this machine — `traveldocs`,
`soldonline`, `statline` and `pintlog` at the time of writing. They will report
no AI usage, correctly, because none was measured here. Add an entry to `repos`
if a checkout appears.

---

## Issuing a token

The collector authenticates with a scoped bearer token (ADR 006a). Issue one
from **the browser admin UI**, signed in with Clerk — `ingestTokens.issue` calls
`requireAdmin`, so `npx convex run` cannot reach it (the CLI has no way to
present an identity).

Give it **only** `ai-usage:write`. The whole point of per-source scopes is that
revoking the phone must not stop the collector, and one all-scope token defeats
it.

**The plaintext is shown exactly once and is stored nowhere.** Copy it
immediately. A lost token is not recovered, it is replaced: revoke the old row,
issue a new one.

Then put it where the collector will find it — environment first, file second:

```sh
# For an interactive run
export COLLECTOR_INGEST_TOKEN='ing_…'

# For launchd, which inherits no shell profile
mkdir -p ~/.config/home-collector
printf '%s' 'ing_…' > ~/.config/home-collector/token
chmod 600 ~/.config/home-collector/token
```

The token is never written to `collector.config.json` — gitignored, but still
the wrong place for a credential — and never into the launchd plist, which is
world-readable by default.

---

## Scheduling

```sh
./launchd/install.sh          # daily at 09:20 local
./launchd/install.sh 07 05    # daily at 07:05 local
./launchd/uninstall.sh
```

`install.sh` renders `launchd/com.coreybaines.home-collector.plist.template`
into `~/Library/LaunchAgents/`, lints it with `plutil`, and loads it with
`launchctl bootstrap`. It is idempotent — re-run it after moving the checkout or
upgrading bun, since the plist hard-codes bun's absolute path (launchd has no
useful `PATH`).

A LaunchAgent rather than a LaunchDaemon: the job reads files in the user's home
directory and must run as the user.

`RunAtLoad` is `false`, so installing does not push. To run it now:

```sh
launchctl kickstart -k gui/$(id -u)/com.coreybaines.home-collector
tail -f ~/Library/Logs/com.coreybaines.home-collector.log
```

If the laptop is asleep at the scheduled minute, launchd runs the job at the
next opportunity. Nothing is lost when it misses a day — see the window below.

---

## How the numbers are arrived at

Read this before quoting any of them.

**A session is one transcript file.** One `~/.claude/projects/<project>/<id>.jsonl`
or one `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Nested directories inside
a Claude project (subagent transcripts, cached tool results, plugin logs) are
not sessions and are skipped.

**A session belongs entirely to the UTC day it started on**, count and hours
both, including one that ran across midnight. UTC because `aiUsageDays.day` is
specified as UTC and the fold, the Snapshot and the phone all agree on that; a
9am Sydney session lands on the previous UTC day, consistently.

**Hours are estimated, and the two agents are estimated differently.** This is
the one place the numbers are not directly comparable, and it is stated here
rather than hidden behind a fudge factor:

| | how | bias |
|---|---|---|
| Claude | sum of gaps between consecutive transcript events, each gap capped at `idleGapMinutes` (30) | close to time actually worked |
| Codex | span from the `session_meta` timestamp to the file's mtime, capped at `maxSessionHours` (6) | **over**-states a session left open |

Codex gets the worse estimator because the better one needs the interior
timestamps, which are on lines 2+, which is 5.4 GB of prompts. Trading an
over-estimate for never touching those is the right trade.

A session with a single recorded event reports zero hours. It still counts as a
session — it happened — but there is no elapsed time to claim and inventing a
nominal minute would be inventing data.

**Day totals are ≥ the sum of the project breakdown**, always, because unmapped
repos are counted in the total and appear in no project. `snapshot.aiUsage`
comes from the totals and `projects.aiBuildStats` from the breakdown; neither is
derivable from the other.

**The window is `lookbackDays` (7) ending today, and every day in it is a
complete recomputation.** Each row upserts on (`day`, `agent`) server-side, so
re-sending is a no-op rather than a doubling — which is what makes a week of
overlap free, and what makes a missed run self-healing. Today's row is always
incomplete and is replaced tomorrow.

The scanners deliberately look one day further back than the window and let the
builder discard the overshoot. Both filter on coarse signals — file mtime for
Claude, local-time day directories for Codex — and a day computed from a partial
set of files would upsert an *incomplete* day over a complete one. Overshooting
costs milliseconds.

### Example dry run

A real run on 2026-07-31, aggregate-only by construction and therefore safe to
paste:

```
  AI usage collector — 2026-07-24 … 2026-07-30 (UTC, 7 days)
  scanned in 0.1s — claude: 11 transcripts read, 16 older than window, 0 unusable,
                    codex: 76 first-lines read, 215 day dirs skipped, 0 unusable

  sessions in window   81
  hours in window      57.26
  day/agent rows       11
  unattributed         34 sessions across 9 unmapped repos (counted in totals, no project)
  dropped              6 sessions outside the window

  per agent
    codex       71 sessions     29.16 h
    claude      10 sessions     28.10 h

  per project (the breakdown that reaches projects.aiBuildStats)
    quotecloud        39 sessions     23.45 h
    home               6 sessions      6.80 h
    zerorisk           2 sessions      5.73 h
```

Back-to-back runs are byte-identical; the figures move between runs only as the
underlying files do (an open session's mtime advances, so its span grows).

Note "9 unmapped repos" — a count, never a list. Naming them is the thing ADR
008 forbids.

---

## Configuration

`collector.config.json` (gitignored — copy `collector.config.example.json`), all
fields optional except `convexSiteUrl` and `repos`:

| field | default | |
|---|---|---|
| `convexSiteUrl` | — | Convex **HTTP actions** origin: `https://<deployment>.convex.site`, *not* `.convex.cloud`. Override per-run with `$COLLECTOR_CONVEX_SITE_URL`. |
| `tokenEnvVar` | `COLLECTOR_INGEST_TOKEN` | Environment variable holding the plaintext token. |
| `tokenFile` | `~/.config/home-collector/token` | Fallback when the environment has none — the path that works under launchd. |
| `claudeProjectsDir` | `~/.claude/projects` | |
| `codexSessionsDir` | `~/.codex/sessions` | |
| `lookbackDays` | `7` | Days recomputed and re-sent, including today. |
| `idleGapMinutes` | `30` | Longest pause still counted as working time (Claude). |
| `maxSessionHours` | `6` | Ceiling on one session (load-bearing for Codex). |
| `repos` | — | The mapping. See above. |

---

## Files

| | |
|---|---|
| `collector.ts` | CLI. Dry run is the default; `--push` is the only route to the network. |
| `config.ts` | Config loading, token resolution, and the repo→slug resolver. |
| `sessions.ts` | `SessionSample`, the duration estimators, UTC day attribution. |
| `scan-claude.ts` | `~/.claude/projects` → samples, by streaming for timestamps. |
| `scan-codex.ts` | `~/.codex/sessions` → samples, by reading line 1 only. |
| `payload.ts` | The privacy boundary. Samples → the validated wire body. |
| `push.ts` | The only socket. POST, retry on 5xx, never on 4xx. |
| `collector.test.ts` | The privacy tests. Fixture repo names are invented, never this machine's. |
| `collector.config.example.json` | Committed template. `collector.config.json` is gitignored. |
| `launchd/` | plist template, install, uninstall. |

No dependencies. The Zod contract is imported by relative path from
`packages/types`, the way `tooling/seed` imports `apps/web` — `tooling/` is not
in the root `workspaces` globs, and adding it would mean touching the shared
lockfile for a script that needs nothing installed.

For the same reason there is no `tsconfig.json` here (nor in `tooling/seed`) and
`turbo run typecheck` does not cover this package: a config would need
`@types/bun`, which is not installed and cannot be added without the lockfile.
The sources were typechecked by hand against `@types/node` plus the DOM lib —
clean apart from `Bun.file` and `import.meta.main`, which are exactly the two
things those types cannot know about:

```sh
bunx tsc --noEmit --target ES2022 --lib ES2022,DOM,DOM.Iterable --module esnext \
  --moduleResolution bundler --strict --noUncheckedIndexedAccess \
  --verbatimModuleSyntax --skipLibCheck --types node \
  --typeRoots ../../apps/web/node_modules/@types \
  collector.ts config.ts payload.ts push.ts scan-claude.ts scan-codex.ts sessions.ts
```

---

## Known limits

- **Codex hours over-state** sessions left open. See the table above.
- **Segment matching can false-positive**: a path containing a mapped repo's
  name as a directory somewhere unrelated attributes to that project. The
  mapping is your own list of your own checkouts and the consequence is a
  slightly wrong count on your own site; anchoring to a root instead would miss
  the three real worktree shapes.
- **A prompt containing the literal text `"timestamp":"…Z"`** will be matched by
  the Claude scanner. What leaks from that is *a date*, into a gap sum — bounded
  by a sanity window against the file's mtime and by the idle cap. It is a
  smaller exposure than a JSON parser holding the message in memory, which is
  the alternative.
- **`hours` is per-agent locally but the Snapshot's `aiUsage.agents[]` carries
  only `{ name, sessions }`.** Per-agent hours reach the site through
  `aiUsage.totalHours` and `projects.aiBuildStats`; widening that object is a
  Snapshot change, not a collector change.

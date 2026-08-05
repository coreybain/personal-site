# ADR 0019 — Off the Clock is a personal dashboard

- **Date:** 2026-08-05
- **Status:** Accepted

## Context

ADR 0003 established a life signal strip on the homepage. Its first HealthKit-backed version used
the three most recent movement days as three separate cards. That made the section technically
live, but not meaningfully varied: three cards repeated the same type of information, individual
days lacked enough context to say whether they were notable, and the result said little about the
personal projects that are also part of life outside work.

The `/labs` data already provides a stronger complementary signal. It contains deliberately
curated personal projects, cover art, summaries, and per-repository GitHub activity. The homepage
can therefore show both making and movement without introducing another content model or another
request-time data source.

## Decision

Replace the three daily movement cards with an **Off-clock Dashboard** containing at most three
equal peer cards in fixed roles:

1. **Favorite Lab** — the published Lab explicitly selected in Site Settings. The initial
   selection is PartyBooth.
2. **Ranked Lab** — a distinct, currently eligible Lab selected from live public GitHub activity.
3. **Movement** — one trailing-seven-day HealthKit summary, not one card per day.

The roles are product behavior, not generic CMS slots. Fun Entries remain on `/fun`; they do not
fill empty homepage roles.

### Favorite and ranked Labs

`favoriteLabSlug` is an optional Site Settings value and is independent of a Lab's `featured`
flag. `featured` remains editorial curation for Labs surfaces; Favorite Lab is the owner's single
explicit homepage choice. Both the web admin and iOS settings UI expose the same published-Lab
picker, including a no-selection state.

The Favorite Lab card is editorial, so freshness does not decide whether the project itself is
shown. When its GitHub statistics are fresh, the card includes yearly commits and last-push
recency. When they are stale, the project still renders but numeric statistics are suppressed and
the card reports its last-sync state, including when it has never synced. An unresolved or
unpublished selection does not create an empty card.

A Lab is eligible for the Ranked Lab role only when all of the following are true:

- it is published;
- it resolves to a public GitHub repository;
- it has a `syncedAt` value; and
- `syncedAt` is no more than 48 hours older than the dashboard snapshot's `computedAt` value.

Private, missing, unresolved, and stale repository statistics are excluded rather than presented
as current. The favorite is excluded from the ranked card so that the two project cards are always
distinct.

The default ranking is yearly commits descending, then `lastPushedAt` descending, then slug
ascending. If that ranking's overall winner is already the Favorite Lab, the Ranked Lab becomes
the freshest distinct eligible Lab instead: `lastPushedAt` descending, then yearly commits
descending, then slug ascending. If no distinct eligible Lab remains, the Ranked Lab card is
omitted.

Each project card uses real cover imagery when present and a procedural visual fallback when it is
not. It shows the role, title, a short summary, primary language, eligible live statistics, and a
link to that project's anchor on `/labs`.

### Seven-day movement

The Movement card represents exactly seven consecutive calendar-day slots, ordered oldest to
newest and ending on the current snapshot day. The current day is explicitly treated as partial;
it is not implied to be a completed daily result.

The seven bars use steps as their comparable measure and visually identify the peak day. A day
reported by HealthKit with zero movement is a real zero and remains a zero-height value. A day for
which no sample was received is missing data and must be styled and labelled differently from
zero. The card footer reports trailing-period steps, kilometres, and workouts. When there is no
usable HealthKit summary, the Movement card is omitted.

### Rendering and responsive behavior

The dashboard is a pure server-side projection of the existing Snapshot, Labs, and Site Settings
data. Selection, freshness checks, seven-day normalization, and totals are computed before render.
The section adds no client-side fetch, carousel, tab state, or hydration requirement; the cards and
their links work with zero client JavaScript.

The layout adapts from one to two to three columns while preserving equal hierarchy between the
available cards. Missing roles are omitted without placeholders. The entire Off the Clock section
is hidden only when all three roles are unavailable.

## Consequences

- The homepage gains a more personal and varied signal without duplicating the full Labs or Fun
  pages.
- One seven-day chart makes movement legible as a pattern and avoids giving three isolated days
  artificial importance.
- A manually chosen favorite remains stable while the ranked card can change with real activity;
  their separate rules prevent a single project from occupying both roles.
- Freshness and public-repository gates trade some card availability for honest statistics. A
  failed or private sync cannot win a ranking using an old stored number.
- Adding `favoriteLabSlug` requires whole-record Site Settings writers on web and iOS to preserve
  the field, and requires the setting to remain backward-compatible while existing records are
  migrated.
- The zero-JavaScript projection preserves the fixed, server-rendered dashboard discipline in
  ADRs [0003](0003-homepage-living-dashboard.md) and
  [0004](0004-precomputed-snapshot.md).

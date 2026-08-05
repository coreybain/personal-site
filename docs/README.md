# docs

`adr/` holds the architecture decision records for this build — one dated file per settled
decision, numbered in the order the decisions were made, from `0001-fresh-repo.md` through
`0019-off-clock-personal-dashboard.md` (with `0006a` splitting machine-token auth out from human
auth). Each record follows the same four-part shape: the pressure that forced a choice
(**Context**), the choice itself (**Decision**), and what accepting it costs or enables
(**Consequences**), under a **Status** line. They exist so that a decision's *reasoning* survives
longer than the memory of making it — when something later looks arbitrary, the ADR is where to
find out whether it was. `glossary/glossary.md` holds the project's vocabulary: Snapshot, Signal,
Ingest, Collector, Attribution, and the rest. Those words name specific tables, privacy
boundaries, and performance guarantees, so the glossary is the reference for using them
precisely rather than loosely.

**ADRs are append-only.** An accepted record is never rewritten and never deleted, because its
value is precisely that it captures what was believed at the time. When a decision changes,
either add an **Amendment** section to the existing record — as ADR 0001 does, noting that the
fresh repo landed at `~/GitHub/personal-site` rather than the originally recorded `~/GitHub/home`
while the decision itself stood — or write a new, higher-numbered ADR that supersedes it and mark
the old one's Status accordingly. Amend when the decision holds and only a detail moved;
supersede when the decision itself is reversed. Either way the original text stays readable, so
the history reads as a sequence of choices rather than a single always-correct present tense.

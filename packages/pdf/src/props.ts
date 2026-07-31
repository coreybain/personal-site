/**
 * props.ts — the input contract for the PDF résumé.
 *
 * ── Why this file exists at all ────────────────────────────────────────────
 *
 * The Glossary says the **Resume Document** is "one Convex-backed record, web
 * resume and PDF render from the same data". That is a claim about *data*, not
 * about code: `apps/web` renders it as a Horizon page with Tailwind and CSS
 * custom properties, this package renders it as A4 with @react-pdf/renderer, and
 * neither renderer may import the other. So the contract has to live somewhere
 * both can see it, and that somewhere is `@home/types` — already the source of
 * truth for the Convex schema (`ResumeDocumentSchema`, `IdentitySchema`,
 * `GitStatsSchema`).
 *
 * Everything below is therefore a *narrowing* of `@home/types`, never a
 * restatement. `Pick<>` rather than a hand-copied object literal, so that
 * renaming `identity.github` in the schema breaks this file at compile time
 * instead of silently printing an empty line onto a résumé.
 *
 * ── The rules this file obeys ──────────────────────────────────────────────
 *
 *   • **No import may reach into apps/web.** `@/lib/snapshot`'s `Identity`,
 *     `GitStats` and `ResumeDocument` are structurally identical to the ones
 *     re-picked here (the web mock is written against the same schema), so the
 *     page can hand its own values straight to `renderResumePdf` and TypeScript
 *     accepts them by structure. That is the whole trick: shared shape, zero
 *     shared module.
 *
 *   • **Plain data only.** No functions, no `Date` objects, no class instances.
 *     Everything on `ResumePdfProps` survives `JSON.stringify` unchanged,
 *     because the route handler that will call this receives its data from a
 *     Convex query and must be able to pass it through untouched.
 *
 *   • **Narrow, not wide.** The PDF prints a subset of what /resume shows: no
 *     contribution calendar, no AI-usage panel, no derived weekly cadence. Those
 *     are screen affordances. Asking for `Pick<GitStats, …>` rather than
 *     `GitStats` keeps a 365-element calendar out of a props object that only
 *     ever needed two integers, and documents which two.
 *
 *   • **Deterministic.** `computedAt` and `generatedAt` are ISO instants the
 *     caller supplies. Nothing in this package reads the clock except
 *     `renderResumePdf`'s default for `generatedAt`, which exists so a route
 *     handler does not have to think about it — and which the fixture harness
 *     always overrides so two runs produce the same document.
 */

import type { GitStats, Identity, ResumeDocument } from '@home/types';

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

/**
 * Who the résumé is about — the header block.
 *
 * The picked set is exactly what gets printed:
 *
 *   name          the display line, 26pt
 *   role          the line under it
 *   company       joined to `role` with a middot ("Principal Engineer ·
 *                 Corporate Interactive"), because on a one-page document the
 *                 current employer belongs in the header rather than being
 *                 discoverable only from the first experience entry
 *   location      hiring managers filter on it before they read anything else
 *   availability  the single most load-bearing string on the site (see
 *                 `IdentitySchema`), printed in the accent colour
 *   email         the contact row a recruiter copies
 *   github        a bare username per `SocialsSchema`; the `github.com/` prefix
 *                 is added by the renderer, never stored
 *   linkedin      a full URL, printed with the scheme stripped
 *
 * `x` is deliberately not picked. A résumé is not a social profile, and the one
 * line it would buy is better spent on the site URL.
 */
export type ResumePdfIdentity = Pick<
  Identity,
  | 'name'
  | 'role'
  | 'company'
  | 'location'
  | 'availability'
  | 'email'
  | 'github'
  | 'linkedin'
>;

/* ------------------------------------------------------------------ *
 * Live stats (ADR 012)
 * ------------------------------------------------------------------ */

/**
 * The two integers behind the live-stats strip.
 *
 * ADR 012 is "the resume embeds live git stats — provably current", and the
 * proof is three facts printed together: how much was contributed in the
 * trailing year, how much of that is private (which is *why* the headline number
 * is credible — private contributions are only visible to Corey's own PAT), and
 * when the snapshot those two came from was computed. The third is `computedAt`
 * on `ResumePdfProps`; the first two are here.
 *
 * The private *share* is a percentage the renderer derives, not a field: storing
 * a rounded percentage next to the two numbers it is computed from is how a
 * document ends up contradicting itself.
 */
export type ResumePdfGitStats = Pick<
  GitStats,
  'totalContributionsYear' | 'privateContributions'
>;

/* ------------------------------------------------------------------ *
 * The document
 * ------------------------------------------------------------------ */

/**
 * The Resume Document itself, straight off `@home/types`.
 *
 * Aliased rather than re-exported bare so the PDF's vocabulary is complete in
 * one file, and so the day the PDF needs a field the web page does not, there is
 * an obvious place to widen.
 *
 * Note `embedGitStats`: it is a real field the admin edits, and this package
 * honours it. When it is `false` the live-stats strip is not rendered — not
 * hidden, not zeroed — and the document reads as an ordinary résumé. That is the
 * print-safe fallback `ResumeDocumentSchema` describes.
 */
export type ResumePdfDocument = ResumeDocument;

/* ------------------------------------------------------------------ *
 * ResumePdfProps
 * ------------------------------------------------------------------ */

export type ResumePdfProps = {
  identity: ResumePdfIdentity;

  /** The Resume Document. `experience` is printed in the order it arrives. */
  resume: ResumePdfDocument;

  /**
   * Trailing-year git aggregates. Required even when
   * `resume.embedGitStats` is false — the caller reads them from the snapshot it
   * already holds, and making the prop conditional on another prop's runtime
   * value would buy nothing but a discriminated union at every call site.
   */
  gitStats: ResumePdfGitStats;

  /**
   * ISO 8601 instant the snapshot behind `gitStats` was computed. Printed as the
   * third cell of the live strip: the date that makes the other two provable.
   */
  computedAt: string;

  /**
   * ISO 8601 instant this PDF was rendered. Printed in the footer.
   *
   * Optional, and `renderResumePdf` defaults it to `new Date().toISOString()`.
   * It is a prop rather than an unconditional `Date.now()` so the fixture
   * harness can pin it — a document whose bytes change every second cannot be
   * diffed, and the whole point of the harness is to make layout regressions
   * visible.
   *
   * It is *not* the same as `computedAt` and must never be conflated with it:
   * `generatedAt` says when the file was made, `computedAt` says how fresh the
   * numbers inside it are. A PDF generated today from a snapshot computed a week
   * ago should say so.
   */
  generatedAt?: string;

  /**
   * The canonical résumé URL, without a scheme — e.g.
   * `'coreybaines.com/resume'`. Printed in the header contact block and in the
   * footer's provenance line.
   *
   * Scheme-less because it is read, not clicked: on paper `https://` is noise,
   * and the `<Link>` wrapping it supplies the scheme for the on-screen PDF.
   */
  siteUrl?: string;
};

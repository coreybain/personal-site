/**
 * theme.ts — the print palette, the type scale and every style the document uses.
 *
 * ── Where these numbers come from ──────────────────────────────────────────
 *
 * `apps/web/src/app/(site)/resume/resume.css` already contains a considered
 * paper treatment: an `@media print` block that overrides the Horizon custom
 * properties with a black-on-white set (`--hor-ink: #000000`, `--hor-ink-2:
 * #1d1d24`, a `#1f1f4a` accent that is a navy rather than the screen's violet,
 * and three hairline weights). `INK`, `RULE` and `ACCENT` below are that block,
 * translated: the alpha-composited rules are resolved against white because PDF
 * has no cascade to composite them in.
 *
 * So the PDF is not "a print theme invented for the PDF". It is the same paper
 * treatment the browser's own print dialog produces, rendered by a different
 * engine — which is what makes ADR 011's promise (one Resume Document, two
 * renderers, no disagreement) true visually as well as textually.
 *
 * The *scale* is not carried over. Horizon's is a `clamp()` viewport scale in
 * rem; a PDF page is a fixed 595.28 × 841.89pt object with no viewport, so the
 * ratios are kept and the units are re-derived in points against an A4 measure.
 * Body sits at 9pt against a 487pt column, which would be about 105 characters —
 * past the comfortable range, and the reason every run of prose is capped at
 * `MEASURE` rather than allowed to fill the column.
 *
 * ── The one rule for editing this file ─────────────────────────────────────
 *
 * Restraint is the design. There is exactly one accent colour and it is used in
 * exactly three places (the availability line, the bullet squares, the live
 * strip's readouts). There is no background fill anywhere on the page, no
 * rounded corner, no shadow. Everything separating one thing from another is a
 * hairline or whitespace. Adding a fourth accent use, or a first fill, will make
 * the document louder than the work it describes.
 */

import { StyleSheet } from '@react-pdf/renderer';

import { FONT_FAMILY, FONT_WEIGHT } from './fonts';

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */

/**
 * Ink. Four steps, exactly as the print stylesheet declares them.
 *
 * `ink` is a true black and stays one: it is used only for the name and the
 * live-strip readouts, where a full-strength stroke is the point. Body copy runs
 * at `ink2` (#1d1d24) — near-black, ~92% of the way there — because a page of
 * pure-black 9pt text is heavier than it needs to be, on screen and in laser
 * print alike.
 */
export const INK = {
  /** #000. Name, section labels, readouts. */
  ink: '#000000',
  /** Body copy, role summaries, capability lines. */
  ink2: '#1d1d24',
  /** Secondary: company names, dates, sub-labels. */
  ink3: '#33333d',
  /** Tertiary: mono indices, footer, the quietest metadata. */
  ink4: '#43434f',
} as const;

/**
 * Hairlines, resolved against white.
 *
 * The print stylesheet declares these as `rgba(0, 0, 0, α)` over a white page:
 * α 0.13 → #dedede, α 0.24 → #c2c2c2, α 0.42 → #949494. Resolved here because a
 * PDF has no compositing context to resolve them in later, and because a solid
 * grey survives a photocopier that an alpha channel does not.
 */
export const RULE = {
  /** α 0.13 — inside a list, between capability rows. */
  soft: '#dedede',
  /** α 0.24 — between sections. The default. */
  base: '#c2c2c2',
  /** α 0.42 — the live strip's boundary, and the footer rule. */
  strong: '#949494',
} as const;

/**
 * The single accent. `#1f1f4a` — the navy the print stylesheet substitutes for
 * Horizon's screen violet, because a saturated violet at 90% lightness prints as
 * an indistinct grey and photocopies as nothing at all.
 */
export const ACCENT = '#1f1f4a';

export const PAPER = '#ffffff';

/**
 * The measure — the width body prose is allowed to run to, in points.
 *
 * 440pt is about 95 characters at 9pt. That is at the wide end of what reads
 * comfortably, and it is chosen rather than the full 487pt column so that the
 * document has a visible right-hand rag: the section rules and the date column
 * run to the true margin, the prose stops short of it, and the difference is
 * what stops a page of hairlines and text from reading as one grey block.
 *
 * Applied to the opening summary, every role summary and every highlight, so all
 * three rag at the same place. A highlight adds `MEASURE_BULLET_OFFSET` for its
 * marker and gutter, which is the only reason that constant exists.
 */
export const MEASURE = 440;

/** Bullet square (2.5pt) plus its gutter (7pt). See `MEASURE`. */
const MEASURE_BULLET_OFFSET = 9.5;

/* ------------------------------------------------------------------ *
 * Page geometry
 * ------------------------------------------------------------------ */

/**
 * A4 height in points, as @react-pdf resolves `size="A4"`. A literal because the
 * footer has to be anchored from the top rather than the bottom — see
 * `PAGE.footerTop`, which is the only thing that reads it.
 */
const A4_HEIGHT = 841.89;

/**
 * Page margins, in points. A4 is 595.28 × 841.89pt, so a 54pt side margin leaves
 * a 487pt measure — the "generous margins" the design calls for, and close to
 * the 19mm most word processors default to, which matters because the document
 * has to look at home in a stack of résumés printed from Word.
 *
 * `marginBottom` is larger than `marginTop` to make room for the fixed footer,
 * which is absolutely positioned inside the bottom margin rather than flowing
 * after the content. Without the extra room the last line of a full page would
 * collide with it.
 */
export const PAGE = {
  height: A4_HEIGHT,
  marginX: 54,
  marginTop: 42,
  marginBottom: 56,

  /**
   * Where the fixed footer's rule sits, measured from the page **top**.
   *
   * ── Why not `bottom` ──────────────────────────────────────────────────
   *
   * Because it does not work. @react-pdf resolves a `render` prop in a second
   * pass, after layout, and an absolutely positioned node anchored with
   * `bottom` that contains dynamic content is silently dropped from every page
   * — no error, no warning, no footer. Anchoring the same node with `top`
   * renders it correctly, on every page, with correct `pageNumber` and
   * `totalPages`. Reproduced against @react-pdf/renderer 4.5.1 by bisecting the
   * style: `bottom` + static text works, `top` + dynamic text works, `bottom` +
   * dynamic text vanishes.
   *
   * The page number is the whole reason the footer is dynamic, and a two-page
   * résumé without "1 / 2" on it is a résumé that can be handed over with a page
   * missing. So the footer is pinned from the top instead, which is only
   * possible because the paper size is a known constant — an A4 page is always
   * 841.89pt tall, so "47pt up from the bottom edge" and "794.89pt down from the
   * top edge" are the same place.
   *
   * The consequence to remember: **changing `size` on the `<Page>` means
   * changing `A4_HEIGHT`.** Nothing else in this package depends on the paper
   * size.
   */
  footerTop: A4_HEIGHT - 47,

  /** Where the continuation header sits on pages 2+, from the page top. */
  runningHeadTop: 22,
} as const;

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

export const styles = StyleSheet.create({
  /* ---- page ---------------------------------------------------------- */

  page: {
    backgroundColor: PAPER,
    color: INK.ink2,
    fontFamily: FONT_FAMILY.sans,
    fontSize: 9,
    lineHeight: 1.5,
    paddingTop: PAGE.marginTop,
    paddingBottom: PAGE.marginBottom,
    paddingHorizontal: PAGE.marginX,
  },

  /* ---- header -------------------------------------------------------- */

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },

  /** Left of the header. `flexShrink` lets a long name compress the gutter
   *  rather than pushing the contact block off the page. */
  headerMain: {
    flexGrow: 1,
    flexShrink: 1,
    paddingRight: 24,
  },

  /**
   * Right of the header. Fixed width, not a flex share: the contact rows are the
   * one block whose measure must not move when the name gets longer, because
   * `github.com/coreybain` wrapping mid-token is the single ugliest thing that
   * can happen to this page.
   */
  headerAside: {
    width: 176,
    flexGrow: 0,
    flexShrink: 0,
  },

  name: {
    fontSize: 26,
    fontWeight: FONT_WEIGHT.semibold,
    letterSpacing: -1,
    lineHeight: 1.05,
    color: INK.ink,
  },

  /** "Principal Engineer · Corporate Interactive". */
  role: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: FONT_WEIGHT.medium,
    letterSpacing: -0.25,
    color: INK.ink2,
  },

  location: {
    marginTop: 3,
    fontSize: 9,
    color: INK.ink3,
  },

  /** The hiring signal. One of the three permitted accent uses. */
  availability: {
    marginTop: 9,
    fontSize: 8.5,
    fontWeight: FONT_WEIGHT.medium,
    letterSpacing: 0.1,
    color: ACCENT,
  },

  /* ---- contact rows -------------------------------------------------- */

  contactRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },

  contactLabel: {
    width: 42,
    flexGrow: 0,
    flexShrink: 0,
    fontFamily: FONT_FAMILY.mono,
    fontSize: 6.5,
    fontWeight: FONT_WEIGHT.medium,
    letterSpacing: 0.9,
    lineHeight: 1.9,
    color: INK.ink4,
  },

  contactValue: {
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 8.5,
    lineHeight: 1.45,
    color: INK.ink2,
    textDecoration: 'none',
  },

  /* ---- summary ------------------------------------------------------- */

  summaryRule: {
    marginTop: 15,
    borderTopWidth: 0.75,
    borderTopColor: RULE.base,
    borderTopStyle: 'solid',
  },

  summary: {
    marginTop: 12,
    maxWidth: MEASURE,
    fontSize: 9.5,
    lineHeight: 1.62,
    color: INK.ink2,
  },

  /* ---- live strip (ADR 012) ------------------------------------------ */

  strip: {
    marginTop: 17,
    paddingTop: 9,
    paddingBottom: 10,
    borderTopWidth: 0.75,
    borderTopColor: RULE.strong,
    borderTopStyle: 'solid',
    borderBottomWidth: 0.75,
    borderBottomColor: RULE.strong,
    borderBottomStyle: 'solid',
  },

  stripHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  stripCells: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },

  stripCell: {
    flexGrow: 1,
    flexBasis: 0,
    paddingRight: 14,
  },

  /** Cells 2 and 3 carry the divider, so the row has no trailing rule. */
  stripCellDivided: {
    borderLeftWidth: 0.75,
    borderLeftColor: RULE.soft,
    borderLeftStyle: 'solid',
    paddingLeft: 14,
  },

  stripValue: {
    marginTop: 5,
    fontFamily: FONT_FAMILY.mono,
    fontSize: 16,
    fontWeight: FONT_WEIGHT.medium,
    letterSpacing: -0.5,
    lineHeight: 1.1,
    color: INK.ink,
  },

  stripSub: {
    marginTop: 4,
    fontSize: 7.5,
    lineHeight: 1.4,
    color: INK.ink4,
  },

  /* ---- sections ------------------------------------------------------ */

  /**
   * Mono label with a hairline running out to the right margin.
   *
   * Carries the section's leading space itself (`marginTop`) rather than
   * inheriting it from a wrapper. There are no section wrappers — see the
   * flattening note in ResumePdf.tsx, which is a page-break requirement rather
   * than a stylistic choice.
   */
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 19,
    marginBottom: 10,
  },

  sectionRule: {
    flexGrow: 1,
    marginLeft: 10,
    borderTopWidth: 0.75,
    borderTopColor: RULE.base,
    borderTopStyle: 'solid',
  },

  /* ---- experience ---------------------------------------------------- */

  roleHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },

  roleTitle: {
    fontSize: 10.5,
    fontWeight: FONT_WEIGHT.semibold,
    letterSpacing: -0.3,
    lineHeight: 1.25,
    color: INK.ink,
  },

  roleOrg: {
    marginTop: 1.5,
    fontSize: 9,
    fontWeight: FONT_WEIGHT.medium,
    color: INK.ink3,
  },

  roleDates: {
    flexGrow: 0,
    flexShrink: 0,
    paddingLeft: 16,
    fontFamily: FONT_FAMILY.mono,
    fontSize: 8,
    letterSpacing: 0.2,
    color: INK.ink3,
  },

  roleSummary: {
    marginTop: 5,
    maxWidth: MEASURE,
    fontSize: 9,
    lineHeight: 1.55,
    color: INK.ink2,
  },

  /**
   * The gap between one role and the next, carried by the *later* role.
   *
   * ── Why every gap in the flow is a `marginTop` ─────────────────────────────
   *
   * Because a `marginBottom` that straddles the page boundary moves its whole
   * node to the next page, however tall that node is. @react-pdf's `shouldBreak`
   * asks two questions of a node that is about to overflow:
   *
   *     shouldSplit    = height < box.top + box.height
   *     endOfPresence  = box.top + box.height + box.marginBottom + minPresenceAhead
   *     break          = (shouldSplit && !canWrap)
   *                   || (!shouldSplit && endOfPresence > height && …)
   *
   * `shouldSplit` measures the border box; `endOfPresence` measures the border
   * box **plus the bottom margin**. So there is a window exactly `marginBottom`
   * points wide in which a node's content fits on the page but its margin does
   * not — and in that window the first test is false while the second is true,
   * which is the "do not break inside it, break before it" branch. The node is
   * not split. It is relocated whole.
   *
   * That is harmless for a 60pt head group and catastrophic for a bullet list:
   * with the list in a wrapper carrying `marginBottom: 12`, a role whose
   * highlights ended within 12pt of the page foot sent all of them to the next
   * page at once, leaving 377pt of white behind and adding a page.
   * `scripts/orphan-sweep.ts` finds it at `+19 filler` and only there — it is a
   * 12pt-wide target, which is why five hand-written fixtures all missed it.
   *
   * With the gap on the following sibling's `marginTop` the window closes
   * completely: `endOfPresence` and `shouldSplit` then measure the same edge, so
   * the two branches are exact complements and a block that fits, stays. A
   * `marginTop` that straddles is safe — the node's `box.top` is already past the
   * page bottom, so it is simply `isOutside` and moves down cleanly.
   *
   * **Do not add a `marginBottom` to anything in the page-level flow that is
   * allowed to wrap.** `sectionHead` and the role head group keep theirs on
   * purpose: they are `wrap={false}` or heading-like, where "relocate whole"
   * is the behaviour wanted anyway.
   */
  roleGap: {
    marginTop: 12,
  },

  highlightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 3,
    maxWidth: MEASURE + MEASURE_BULLET_OFFSET,
  },

  /** The gap between a role's summary and its first bullet. See `roleGap`. */
  highlightRowFirst: {
    marginTop: 6,
  },

  /**
   * The bullet. A 2.5pt accent square rather than a `·` or a `–`, because a
   * glyph bullet inherits the line box and drifts vertically as soon as a
   * highlight wraps to two lines; a `View` with an explicit `marginTop` sits on
   * the first line's x-height and stays there.
   */
  highlightMark: {
    width: 2.5,
    height: 2.5,
    marginTop: 5,
    marginRight: 7,
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: ACCENT,
  },

  highlightText: {
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 9,
    lineHeight: 1.45,
    color: INK.ink2,
  },

  /* ---- capabilities -------------------------------------------------- */

  /**
   * The heading-plus-ledger group, which is `wrap={false}` (see ResumePdf.tsx).
   *
   * Carries the 12pt that used to sit under the last role's bullet list, so the
   * gap between the end of EXPERIENCE and the CAPABILITIES rule is unchanged at
   * 34pt (3 row + 12 here + 19 `sectionHead.marginTop`) while no longer being a
   * `marginBottom` in the wrapping flow. See `roleGap`.
   */
  capBlock: {
    marginTop: 12,
  },

  capGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },

  capItem: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingRight: 18,
    paddingVertical: 4,
    borderBottomWidth: 0.75,
    borderBottomColor: RULE.soft,
    borderBottomStyle: 'solid',
  },

  capIndex: {
    width: 16,
    flexGrow: 0,
    flexShrink: 0,
    fontFamily: FONT_FAMILY.mono,
    fontSize: 7,
    letterSpacing: 0.4,
    lineHeight: 1.85,
    color: INK.ink4,
  },

  capText: {
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 9,
    lineHeight: 1.4,
    color: INK.ink2,
  },

  /* ---- education ----------------------------------------------------- */

  eduRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 0.75,
    borderBottomColor: RULE.soft,
    borderBottomStyle: 'solid',
  },

  eduInstitution: {
    fontSize: 9.5,
    fontWeight: FONT_WEIGHT.medium,
    color: INK.ink,
  },

  eduCredential: {
    marginTop: 1.5,
    fontSize: 8.5,
    color: INK.ink3,
  },

  /* ---- running head (pages 2+) --------------------------------------- */

  runningHead: {
    position: 'absolute',
    top: PAGE.runningHeadTop,
    left: PAGE.marginX,
    right: PAGE.marginX,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontFamily: FONT_FAMILY.mono,
    fontSize: 6.5,
    letterSpacing: 0.9,
    color: INK.ink4,
  },

  /* ---- footer -------------------------------------------------------- */

  footer: {
    position: 'absolute',
    top: PAGE.footerTop,
    left: PAGE.marginX,
    right: PAGE.marginX,
    paddingTop: 8,
    borderTopWidth: 0.75,
    borderTopColor: RULE.base,
    borderTopStyle: 'solid',
  },

  footerText: {
    fontSize: 7,
    letterSpacing: 0.15,
    color: INK.ink4,
    textDecoration: 'none',
  },

  /**
   * The page number — its own absolutely positioned, `fixed` node rather than a
   * second child of `footer`.
   *
   * Not a stylistic choice either. @react-pdf resolves `render` props in a
   * second pass and rebuilds the `fixed` subtree it finds them in; any *static*
   * sibling inside that subtree is discarded. Putting the dynamic page number
   * beside the static provenance link inside one `footer` View silently drops
   * the link from every page. Two sibling `fixed` nodes, each with a single kind
   * of content, both survive — and the link stays a real `<Link>`, which the
   * alternative (giving the left-hand text a no-op `render` prop) would not.
   *
   * `top` is `footer`'s plus its `paddingTop`, so the two sit on the same
   * baseline either side of the same rule.
   */
  footerPage: {
    position: 'absolute',
    top: PAGE.footerTop + 8,
    right: PAGE.marginX,
    fontFamily: FONT_FAMILY.mono,
    fontSize: 7,
    letterSpacing: 0.6,
    textAlign: 'right',
    color: INK.ink4,
  },

  /* ---- shared -------------------------------------------------------- */

  /** The mono, uppercase, letterspaced label. Horizon's `.hor-label`. */
  label: {
    fontFamily: FONT_FAMILY.mono,
    fontSize: 7,
    fontWeight: FONT_WEIGHT.medium,
    letterSpacing: 1.15,
    lineHeight: 1.2,
    color: INK.ink4,
  },

  /** `.hor-label` at full strength — section headings. */
  labelStrong: {
    fontFamily: FONT_FAMILY.mono,
    fontSize: 7.5,
    fontWeight: FONT_WEIGHT.medium,
    letterSpacing: 1.3,
    lineHeight: 1.2,
    color: INK.ink,
  },

  micro: {
    fontSize: 7.5,
    lineHeight: 1.45,
    color: INK.ink4,
  },
});

/**
 * ResumePdf.tsx — the printed résumé.
 *
 * ── What this document is ──────────────────────────────────────────────────
 *
 * A hiring-manager document. It is read once, quickly, probably on a laptop and
 * possibly on paper, by someone with a stack of them. Everything here follows
 * from that: one to two pages, no colour beyond a single navy accent, no boxes,
 * no fills, a strict left-aligned column with hairlines and whitespace doing all
 * the separating. It echoes Horizon's typographic language (see theme.ts) but it
 * is not a screen theme rendered to PDF — there is no gradient sky, no deck
 * grid, no glass card, because none of those survive a laser printer.
 *
 * ── The one thing no other résumé does ─────────────────────────────────────
 *
 * ADR 012: the live-stats strip. Three facts sit under the summary — the
 * trailing-year contribution total, the private share of it, and the instant the
 * snapshot behind both was computed. They are read from the same Convex document
 * `/resume` reads, at render time, so a PDF downloaded today carries today's
 * numbers and says so. `resume.embedGitStats` is the admin's switch: when it is
 * false the strip is not rendered at all and the document is an ordinary résumé.
 * That branch is real and must stay real — see props.ts.
 *
 * ── Page-break policy ──────────────────────────────────────────────────────
 *
 * @react-pdf breaks a page wherever it runs out of room unless told otherwise,
 * and the failure mode this document must never exhibit is a heading stranded at
 * the foot of one page with its content on the next. Three mechanisms, applied
 * deliberately:
 *
 *   `wrap={false}`        an atomic block. Used on each role's head group
 *                         (title + company + dates + summary), on the live strip
 *                         and on each education row — blocks that are always
 *                         well under a page and are meaningless when split.
 *   `minPresenceAhead`    "do not break within n points *after* me". Used on the
 *                         head group so the break cannot land immediately below
 *                         it, which is the exact stranding case above, and on
 *                         section headings so a heading is never the last thing
 *                         on a page.
 *   `orphans` / `widows`  minimum lines of a wrapping paragraph either side of a
 *                         break. The defaults are 2; the summary raises them,
 *                         because a single orphaned line of the opening
 *                         paragraph is the first thing a reader notices.
 *
 * The pairing is what matters: `wrap={false}` alone keeps the heading with the
 * summary but happily leaves both alone at the bottom of the page, and
 * `minPresenceAhead` alone does not stop the heading itself from splitting off
 * its own dates.
 *
 * ── Why the tree is flat ───────────────────────────────────────────────────
 *
 * The obvious structure — a `<View>` per section wrapping its heading and its
 * content, a `<View>` per role wrapping its head group and its bullets — is the
 * one structure in which `minPresenceAhead` does nothing. @react-pdf's splitter
 * refuses to break before a node when no non-fixed sibling precedes it on the
 * page (`breakingImprovesPresence` in `@react-pdf/layout`), on the reasonable
 * assumption that such a node is already at the top of the page and moving it
 * cannot help. Inside a wrapper that assumption is false: a section heading is
 * the *first child of its wrapper* while sitting at the very bottom of the page,
 * so its `minPresenceAhead` is discarded and it strands — which is exactly what
 * this document did before the wrappers were removed.
 *
 * So every heading, every role head group, every bullet row and every education
 * row is a direct child of `<Page>`, and the spacing that a wrapper would have
 * supplied lives on the blocks themselves — always as `marginTop`, never as
 * `marginBottom`, for the second and unrelated reason set out in `Role` and in
 * theme.ts's `roleGap`. `Role` returns a fragment of its head group and its rows
 * for the same reason; @react-pdf flattens fragments before layout, so they all
 * arrive at page level as intended.
 *
 * Verify any change against `scripts/fixture.ts`'s `longResumeFixture`, which is
 * sized to force a break in the middle of the experience list.
 *
 * ── Server-only ────────────────────────────────────────────────────────────
 *
 * These are @react-pdf primitives, not DOM elements. `View` is not a `div` and
 * this file must never be imported into a client component.
 */

import { Document, Link, Page, Text, View } from '@react-pdf/renderer';

import { bareUrl, isoDay, num, pct, stamp, stampTime } from './format';
import type {
  ResumePdfDocument,
  ResumePdfGitStats,
  ResumePdfIdentity,
  ResumePdfProps,
} from './props';
import { styles } from './theme';

/** Printed when the caller does not override it. See `ResumePdfProps.siteUrl`. */
export const DEFAULT_SITE_URL = 'coreybaines.com/resume';

/* ------------------------------------------------------------------ *
 * Section heading
 * ------------------------------------------------------------------ */

/**
 * How much of a section must fit below its heading for the heading to stay put.
 *
 * 72pt is the tallest block that has to arrive *with* a heading: a role's head
 * group (title, company, dates, summary — about 62pt for a two-line summary)
 * plus its first bullet. Below that the heading moves to the next page.
 *
 * The value is not a guess about whitespace, because the splitter caps it:
 * `getEndOfPresence` takes `Math.min(heading + minPresenceAhead, end of the
 * furthest following sibling)`, so a final section with only 40pt of content
 * asks for 40, not 72, and never forces a break it does not need.
 */
const SECTION_PRESENCE = 72;

/**
 * A mono, letterspaced label with a hairline running out to the right margin.
 *
 * `minPresenceAhead` is the whole reason this is a component rather than two
 * inline elements: every section heading needs the same "do not strand me"
 * guarantee, and it has to be spelled once.
 */
function SectionHead({ children }: { children: string }) {
  return (
    <View style={styles.sectionHead} minPresenceAhead={SECTION_PRESENCE}>
      <Text style={styles.labelStrong}>{children}</Text>
      <View style={styles.sectionRule} />
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Header
 * ------------------------------------------------------------------ */

/**
 * Name, role, location, availability — and the contact block a recruiter copies
 * out of.
 *
 * Every contact value is wrapped in a `<Link>`: on paper it is inert, on a
 * screen the PDF is a live document and a hiring manager who wants to email
 * should not have to retype an address. The visible text is scheme-less
 * (`bareUrl`) while the `href` carries the full URL — see format.ts.
 */
function Header({
  identity,
  availabilityVisible,
  siteUrl,
}: {
  identity: ResumePdfIdentity;
  availabilityVisible: boolean;
  siteUrl: string;
}) {
  const contact = [
    {
      label: 'Email',
      text: identity.email,
      href: `mailto:${identity.email}`,
    },
    {
      label: 'GitHub',
      text: `github.com/${identity.github}`,
      href: `https://github.com/${identity.github}`,
    },
    {
      label: 'Site',
      text: siteUrl,
      href: `https://${bareUrl(siteUrl)}`,
    },
    {
      label: 'LinkedIn',
      text: bareUrl(identity.linkedin),
      href: identity.linkedin,
    },
  ] as const;

  return (
    <View style={styles.header}>
      <View style={styles.headerMain}>
        <Text style={styles.name}>{identity.name}</Text>
        <Text style={styles.role}>
          {identity.role} · {identity.company}
        </Text>
        <Text style={styles.location}>{identity.location}</Text>
        {availabilityVisible ? (
          <Text style={styles.availability}>{identity.availability}</Text>
        ) : null}
      </View>

      <View style={styles.headerAside}>
        {contact.map((row) => (
          <View key={row.label} style={styles.contactRow}>
            <Text style={styles.contactLabel}>{row.label.toUpperCase()}</Text>
            <Link style={styles.contactValue} src={row.href}>
              {row.text}
            </Link>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Live strip — ADR 012
 * ------------------------------------------------------------------ */

/**
 * The three facts that make this document provably current.
 *
 * The private share is derived here rather than passed in (props.ts explains
 * why), and the sub-line under it names the raw count so the percentage can be
 * checked rather than merely believed. The third cell is the snapshot date, not
 * the generation date: it is the one that says how fresh the *numbers* are,
 * while the footer says when the file was made.
 *
 * `wrap={false}` because a three-cell instrument row split across a page break
 * would read as two unrelated fragments. It is ~70pt tall and always sits high
 * on page one, so it can never be the thing that forces a break.
 */
function LiveStrip({
  gitStats,
  computedAt,
}: {
  gitStats: ResumePdfGitStats;
  computedAt: string;
}) {
  const privateShare = pct(
    gitStats.privateContributions,
    gitStats.totalContributionsYear,
  );

  // Every sub-line is written to fit one line in a ~150pt cell. Two-line subs
  // rag differently under each readout and turn an instrument row into three
  // uneven paragraphs; the label above already carries the qualifier the longer
  // wording was repeating.
  const cells = [
    {
      label: 'Contributions · 12 mo',
      value: num(gitStats.totalContributionsYear),
      sub: 'Public and private',
    },
    {
      label: 'Private share',
      value: `${privateShare}%`,
      sub: `${num(gitStats.privateContributions)} restricted, never named`,
    },
    {
      label: 'Snapshot',
      value: stamp(isoDay(computedAt)),
      sub: stampTime(computedAt),
    },
  ] as const;

  return (
    <View style={styles.strip} wrap={false}>
      <View style={styles.stripHead}>
        <Text style={styles.label}>LIVE SIGNAL</Text>
        <Text style={styles.micro}>Read from the site&rsquo;s snapshot at export</Text>
      </View>

      <View style={styles.stripCells}>
        {cells.map((cell, i) => (
          <View
            key={cell.label}
            style={
              i === 0
                ? styles.stripCell
                : [styles.stripCell, styles.stripCellDivided]
            }
          >
            <Text style={styles.label}>{cell.label.toUpperCase()}</Text>
            <Text style={styles.stripValue}>{cell.value}</Text>
            <Text style={styles.stripSub}>{cell.sub}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Experience
 * ------------------------------------------------------------------ */

/**
 * One role.
 *
 * The head group — title, company, dates, summary — is a single `wrap={false}`
 * block carrying `minPresenceAhead`. See the page-break note in this file's
 * header for why both are needed and neither is sufficient.
 *
 * 46pt of presence-ahead is roughly three highlight rows, so a role that begins
 * near the foot of a page moves whole to the next one rather than leaving its
 * heading behind. Highlights themselves are allowed to wrap: a role with eight
 * of them legitimately spans a break, and forcing it not to would push half a
 * page of whitespace ahead of it.
 *
 * ── The bullets are Page-level siblings, not a list container ──────────────
 *
 * They were a container once, and that container had a `marginBottom` to carry
 * the gap to the next role. A wrapping node whose bottom margin — and only whose
 * bottom margin — crosses the page boundary is relocated to the next page in one
 * piece rather than split, so a role whose bullets happened to end within 12pt
 * of the page foot sent the entire list over at once and left a third of the
 * sheet blank. `theme.ts`'s `roleGap` documents the arithmetic; `orphan-sweep.ts`
 * catches it at `+19 filler`.
 *
 * So the rows are page-level siblings like everything else here, and the gaps
 * around them are `marginTop` on whatever comes next: `roleGap` on the following
 * role, `highlightRowFirst` on the first bullet, `capBlock` on the CAPABILITIES
 * group. Flat for the `minPresenceAhead` reason in this file's header, and
 * margin-top-only for this one — two independent constraints that happen to
 * agree.
 *
 * `first` rather than an index: the only thing the position decides is whether
 * this role opens the section (no leading gap — `sectionHead` already supplied
 * one) or follows another.
 */
function Role({
  role,
  first,
}: {
  role: ResumePdfDocument['experience'][number];
  first: boolean;
}) {
  return (
    <>
      <View
        style={first ? undefined : styles.roleGap}
        wrap={false}
        minPresenceAhead={46}
      >
        <View style={styles.roleHead}>
          <View>
            <Text style={styles.roleTitle}>{role.title}</Text>
            <Text style={styles.roleOrg}>{role.company}</Text>
          </View>
          <Text style={styles.roleDates}>
            {role.start} — {role.end}
          </Text>
        </View>

        <Text style={styles.roleSummary}>{role.summary}</Text>
      </View>

      {role.highlights.map((highlight, i) => (
        <View
          key={highlight}
          style={
            i === 0
              ? [styles.highlightRow, styles.highlightRowFirst]
              : styles.highlightRow
          }
        >
          <View style={styles.highlightMark} />
          <Text style={styles.highlightText} orphans={2} widows={2}>
            {highlight}
          </Text>
        </View>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Capabilities
 * ------------------------------------------------------------------ */

/**
 * A two-column ledger of hairline rows with mono indices — the closest this
 * document gets to the deck's instrument grammar, and the same treatment the web
 * résumé's `Capabilities` section uses.
 *
 * A flex-wrap grid rather than two hand-split columns, so an odd count leaves a
 * single trailing row rather than an unbalanced pair, and so the order reads
 * left-to-right in the sequence the admin chose (which `Capabilities.tsx`
 * documents as "the order they tend to matter on a new platform"). The index is
 * therefore meaningful and is printed, not decorative.
 */
function Capabilities({
  capabilities,
}: {
  capabilities: ResumePdfDocument['capabilities'];
}) {
  return (
    // `wrap={false}`: a ledger split across a page break reads as two unrelated
    // half-tables, and — because the grid is one flex container rather than a
    // row of siblings — @react-pdf leaves the residual container behind on the
    // next page, painting a stray full-width hairline above whatever follows.
    // Twelve capabilities is six rows, about 140pt; the list would have to be
    // three times that before this could not fit a page on its own.
    <View style={styles.capGrid} wrap={false}>
      {capabilities.map((capability, i) => (
        <View key={capability} style={styles.capItem}>
          <Text style={styles.capIndex}>{String(i + 1).padStart(2, '0')}</Text>
          <Text style={styles.capText}>{capability}</Text>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Document
 * ------------------------------------------------------------------ */

/**
 * The résumé.
 *
 * A single `<Page>`: @react-pdf paginates by overflow, so one page element
 * produces as many physical pages as the content needs. The running head and the
 * footer are `fixed`, which repeats them on every page the wrapper produces —
 * the running head then hides itself on page one via its `render` prop, because
 * the full header is already there and repeating the name under it would be
 * noise.
 *
 * `Document`'s metadata is filled in properly. It is what an ATS reads first,
 * what a browser tab shows, and what a file manager indexes; leaving it as
 * @react-pdf's defaults would publish a document authored by nobody.
 */
export function ResumePdf({
  identity,
  availabilityVisible,
  resume,
  gitStats,
  computedAt,
  generatedAt,
  siteUrl = DEFAULT_SITE_URL,
}: ResumePdfProps & { generatedAt: string }) {
  const title = `${identity.name} — ${identity.role}`;

  return (
    <Document
      title={title}
      author={identity.name}
      subject={`Résumé · ${identity.role} · ${identity.location}`}
      creator={siteUrl}
      producer={siteUrl}
      keywords={resume.capabilities.join(', ')}
      language="en-AU"
      creationDate={new Date(generatedAt)}
    >
      <Page size="A4" style={styles.page}>
        {/* Pages 2+ only. `fixed` repeats the node; `render` decides whether it
            draws anything, which is the documented way to vary a repeated
            element by page. */}
        <View style={styles.runningHead} fixed>
          <Text
            render={({ pageNumber }) =>
              pageNumber > 1 ? `${identity.name.toUpperCase()} · ${identity.role.toUpperCase()}` : ''
            }
          />
          <Text
            render={({ pageNumber }) =>
              pageNumber > 1 ? bareUrl(siteUrl).toUpperCase() : ''
            }
          />
        </View>

        <Header
          identity={identity}
          availabilityVisible={availabilityVisible}
          siteUrl={siteUrl}
        />

        <View style={styles.summaryRule} />
        <Text style={styles.summary} orphans={3} widows={3}>
          {resume.summary}
        </Text>

        {/* ADR 012, and the admin's switch. Not a hidden section — an absent
            one. */}
        {resume.embedGitStats ? (
          <LiveStrip gitStats={gitStats} computedAt={computedAt} />
        ) : null}

        {/* Flat from here down — headings, role blocks and rows are all direct
            children of the page. See the note in this file's header: nesting
            them in per-section wrappers is what silently disables
            `minPresenceAhead`.

            Each section is gated on having something to show. These are admin-
            edited arrays with no minimum length, and a heading with a rule
            running out to the margin and nothing underneath it reads as a
            rendering fault rather than an omission — which is exactly what
            `minimalResumeFixture` (no education) printed before this guard:
            a bare EDUCATION rule sitting on the footer. */}
        {resume.experience.length > 0 ? (
          <>
            <SectionHead>EXPERIENCE</SectionHead>
            {resume.experience.map((role, i) => (
              <Role
                key={`${role.company}-${role.title}-${role.start}`}
                role={role}
                first={i === 0}
              />
            ))}
          </>
        ) : null}

        {/* The one section whose heading is bound to its content rather than
            trusted to `minPresenceAhead`. The ledger is atomic (see
            `Capabilities`) and taller than any presence-ahead worth asking for,
            so "72pt fits below the heading" would be satisfied on a page where
            the 115pt grid plainly does not — stranding the heading. A
            `wrap={false}` group makes the pair move together, exactly. */}
        {resume.capabilities.length > 0 ? (
          <View style={styles.capBlock} wrap={false}>
            <SectionHead>CAPABILITIES</SectionHead>
            <Capabilities capabilities={resume.capabilities} />
          </View>
        ) : null}

        {resume.education.length > 0 ? (
          <>
            <SectionHead>EDUCATION</SectionHead>
            {resume.education.map((entry) => (
              <View
                key={`${entry.institution}-${entry.credential}`}
                style={styles.eduRow}
                wrap={false}
              >
                <View>
                  <Text style={styles.eduInstitution}>{entry.institution}</Text>
                  <Text style={styles.eduCredential}>{entry.credential}</Text>
                </View>
                <Text style={styles.roleDates}>
                  {entry.start} — {entry.end}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {/* The colophon. On paper this is the only footer there is — the shared
            site footer belongs to the web page and has no equivalent here.

            Two `fixed` nodes rather than one two-column row: a static sibling
            inside a `fixed` subtree that also contains a `render` prop is
            discarded by the layout engine's dynamic pass. theme.ts's
            `footerPage` documents the bisect. */}
        <View style={styles.footer} fixed>
          <Link style={styles.footerText} src={`https://${bareUrl(siteUrl)}`}>
            Generated {stamp(isoDay(generatedAt))} — {siteUrl}
          </Link>
        </View>
        <Text
          style={styles.footerPage}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

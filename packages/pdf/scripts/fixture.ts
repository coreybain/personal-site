/**
 * fixture.ts — the data the dev harness renders.
 *
 * ── Why this is a copy ─────────────────────────────────────────────────────
 *
 * Every string below is transcribed from `apps/web/src/lib/snapshot.ts`'s mock —
 * the same `identity`, `resumeDocument` and `gitStats` the site falls back to
 * when Convex is empty or unconfigured. Transcribed, not imported: this package
 * must not reach into apps/web (see src/props.ts), and a harness that imported
 * the app's mock would drag Next's module graph and its `@/` path aliases into a
 * plain Bun script for no benefit.
 *
 * The copy is also the point of the exercise. `resumeFixture` typechecks against
 * `ResumePdfProps`, which is built from `@home/types` — so if the two ever
 * disagree about the Resume Document's shape, this file fails to compile. It is
 * a schema-conformance test that happens to also be a design proof.
 *
 * Being a copy, it will drift from the web mock's *content* over time, and that
 * is fine. What must not drift is the shape.
 *
 * ── Dev-only ───────────────────────────────────────────────────────────────
 *
 * Under `scripts/`, not `src/`, and not re-exported from the package index.
 * Nothing shipped depends on it.
 */

import type { ResumePdfProps } from '../src/props';

/**
 * Pinned, not `new Date()`.
 *
 * Both stamps are literals so two runs of the harness produce byte-identical
 * PDFs and a layout regression shows up as a visual diff rather than being lost
 * in a churn of timestamps. `computedAt` is a few hours before `generatedAt` on
 * purpose: it exercises the distinction the footer and the live strip are
 * supposed to draw between "when the numbers were measured" and "when the file
 * was made", which a single shared timestamp would hide.
 */
const COMPUTED_AT = '2026-07-31T06:00:00Z';
const GENERATED_AT = '2026-07-31T12:30:00Z';

/* ------------------------------------------------------------------ *
 * The realistic case
 * ------------------------------------------------------------------ */

/**
 * The document as it actually is today: three roles, eight capabilities, one
 * degree.
 *
 * It renders as two pages, and that is the intended shape rather than a
 * shortfall: page one carries the header, the summary, the live strip and the
 * whole of the experience section, and the break lands on the boundary between
 * EXPERIENCE and CAPABILITIES. Fitting all of it onto one page would mean
 * dropping the live strip (which is the document's entire argument, ADR 012) or
 * taking body copy below 8pt. The brief allows one to two pages; this is the
 * two-page composition, and the thing to check is that page one is *full* — if
 * it starts leaving a hand's width of whitespace above the footer, the type
 * scale in src/theme.ts has drifted and should be pulled back.
 */
export const resumeFixture: ResumePdfProps = {
  identity: {
    name: 'Corey Baines',
    role: 'Principal Engineer',
    company: 'Corporate Interactive',
    location: 'Sydney, Australia',
    availability: 'Open to Principal Engineer roles',
    email: 'corey@spiritdevs.com',
    github: 'coreybain',
    linkedin: 'https://www.linkedin.com/in/coreybaines/',
  },
  availabilityVisible: true,

  resume: {
    summary:
      'Principal engineer with a decade building the platforms other teams depend on — document automation, compliance, real-time auctions. I work end to end: the architecture, the delivery, and the people around both. For the last two years that has meant running agents in the loop every day, which is why the numbers on this site are measured rather than claimed.',
    experience: [
      {
        company: 'Corporate Interactive',
        title: 'Principal Engineer',
        start: '2022',
        end: 'Present',
        summary:
          'Technical lead across four production platforms, owning architecture, delivery standards and the engineering practice around them.',
        highlights: [
          'Set the architecture for four platforms serving enterprise customers',
          'Introduced agent-assisted delivery across the engineering team',
          'Mentored engineers from mid-level to senior ownership',
        ],
      },
      {
        company: 'Corporate Interactive',
        title: 'Senior Software Engineer',
        start: '2018',
        end: '2022',
        summary:
          'Built and shipped the first versions of the document and compliance platforms, moving from feature work into system ownership.',
        highlights: [
          'Shipped the first production release of the quoting platform',
          'Rebuilt the rendering pipeline behind pixel-accurate PDF output',
          'Established the testing and release process still in use',
        ],
      },
      {
        company: 'Freelance & contract',
        title: 'Full-stack Developer',
        start: '2015',
        end: '2018',
        summary:
          'Independent delivery for small teams and startups — full-stack web work, usually as the only engineer on the project.',
        highlights: [
          'Delivered end-to-end web products as sole engineer',
          'Worked directly with founders on scope and trade-offs',
          'Learned to ship small, ship often and own the consequences',
        ],
      },
    ],
    capabilities: [
      'Platform architecture and system design',
      'TypeScript, React and Next.js at production scale',
      '.NET and C# services',
      'Relational data modelling — PostgreSQL and SQL Server',
      'Real-time systems: websockets, queues, durable workflows',
      'Cloud delivery on Azure and AWS',
      'Agent-assisted engineering workflows',
      'Technical leadership, mentoring and hiring',
    ],
    education: [
      {
        institution: 'University of Technology Sydney',
        credential: 'BSc, Computer Science',
        start: '2011',
        end: '2014',
      },
    ],
    embedGitStats: true,
  },

  gitStats: {
    totalContributionsYear: 6434,
    privateContributions: 5792,
  },

  computedAt: COMPUTED_AT,
  generatedAt: GENERATED_AT,
};

/* ------------------------------------------------------------------ *
 * The stress case
 * ------------------------------------------------------------------ */

/**
 * Deliberately oversized, to force page breaks in the places that break badly.
 *
 * Six roles instead of three, with highlight lists long enough that the
 * experience section spans two pages, and a fourth role sized so its heading
 * lands within a few points of the page foot — the exact case
 * `minPresenceAhead` on the role head group exists to catch (see the
 * page-break note in src/ResumePdf.tsx).
 *
 * It also carries the pathological strings the real data never will and the
 * layout must survive anyway:
 *
 *   - a 60-character unbroken URL in a highlight, which is what
 *     `resumeHyphenationCallback` in src/fonts.ts is for;
 *   - a role title long enough to collide with its own date column;
 *   - a capability line long enough to wrap inside a 50%-width grid cell;
 *   - a second education row, so that section is not implicitly single-row.
 *
 * If any of those looks wrong in `tmp/fixture-long.pdf`, the fix belongs in
 * theme.ts or ResumePdf.tsx — never here.
 */
export const longResumeFixture: ResumePdfProps = {
  ...resumeFixture,
  resume: {
    ...resumeFixture.resume,
    experience: [
      {
        company: 'Corporate Interactive',
        title: 'Principal Engineer, Platform & Delivery',
        start: 'Mar 2022',
        end: 'Present',
        summary:
          'Technical lead across four production platforms, owning architecture, delivery standards and the engineering practice around them. Accountable for the technical direction of document automation, compliance and real-time auction systems used by enterprise customers across Australia and New Zealand.',
        highlights: [
          'Set the architecture for four platforms serving enterprise customers, each with its own delivery cadence, compliance surface and integration estate',
          'Introduced agent-assisted delivery across the engineering team and published the measured results at https://coreybaines.com/labs/agent-assisted-delivery-measurements',
          'Mentored engineers from mid-level to senior ownership, running the internal review track and the hiring loop',
          'Rebuilt the release process around trunk-based development, cutting median lead time from eleven days to under two',
          'Owned the incident practice: on-call rotation, blameless review, and the error-budget conversation with the business',
        ],
      },
      {
        company: 'Corporate Interactive',
        title: 'Senior Software Engineer',
        start: 'Jan 2018',
        end: 'Mar 2022',
        summary:
          'Built and shipped the first versions of the document and compliance platforms, moving from feature work into system ownership.',
        highlights: [
          'Shipped the first production release of the quoting platform, from an empty repository to paying customers in nine months',
          'Rebuilt the rendering pipeline behind pixel-accurate PDF output, replacing a headless-browser stage with a deterministic typesetting layer',
          'Established the testing and release process still in use across the engineering group',
          'Migrated the primary datastore with zero downtime across a fourteen-hour cutover window',
        ],
      },
      {
        company: 'Freelance & contract',
        title: 'Full-stack Developer',
        start: 'Feb 2015',
        end: 'Jan 2018',
        summary:
          'Independent delivery for small teams and startups — full-stack web work, usually as the only engineer on the project.',
        highlights: [
          'Delivered end-to-end web products as sole engineer, from discovery through to production support',
          'Worked directly with founders on scope and trade-offs, which is where the habit of writing the decision down started',
          'Learned to ship small, ship often and own the consequences',
        ],
      },
      {
        company: 'Sydney Digital Works',
        title: 'Software Engineer',
        start: 'Jun 2013',
        end: 'Feb 2015',
        summary:
          'Application work across a portfolio of client builds, mostly server-rendered .NET with a growing front-end surface.',
        highlights: [
          'Delivered eleven client projects across retail, logistics and government',
          'Introduced the first automated test suite the team had, and the build that ran it',
          'Took over the on-call pager for the two largest accounts',
        ],
      },
      {
        company: 'Northbridge Systems',
        title: 'Junior Developer',
        start: 'Jan 2012',
        end: 'Jun 2013',
        summary:
          'First professional role. Maintenance and feature work on a long-lived line-of-business application.',
        highlights: [
          'Maintained a decade-old codebase without breaking it, which taught more than any greenfield project since',
          'Wrote the internal documentation the team had been meaning to write for three years',
        ],
      },
      {
        company: 'University of Technology Sydney',
        title: 'Undergraduate Research Assistant',
        start: 'Jul 2011',
        end: 'Dec 2011',
        summary:
          'Tooling and data work for a distributed-systems research group.',
        highlights: [
          'Built the harness that collected and reduced the group experimental results',
        ],
      },
    ],
    capabilities: [
      ...resumeFixture.resume.capabilities,
      'Distributed systems design, consistency models and failure-mode analysis under sustained production load',
      'Observability: structured logging, tracing, and the error-budget conversation',
      'Security review and threat modelling',
      'Technical writing — ADRs, design docs, post-incident review',
    ],
    education: [
      ...resumeFixture.resume.education,
      {
        institution: 'Australian Computer Society',
        credential: 'Certified Professional',
        start: '2019',
        end: '2019',
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * The two QA bounds
 * ------------------------------------------------------------------ */

/**
 * The upper bound: everything long at once.
 *
 * `longResumeFixture` is the *realistic* stress case — six roles that a real
 * person might have. This one is the case nobody has, and it exists to answer a
 * different question: when the document is unambiguously over-length, does it
 * degrade or does it break?
 *
 * Every axis is pushed past the long fixture simultaneously — a four-line
 * opening summary, six roles each with a three-line role summary, seven to eight
 * highlights per role, sixteen capabilities, three education rows. It runs to
 * five pages. The things to look for, in order of severity:
 *
 *   1. **Orphaned headings.** No page may end with a role title (or a section
 *      label) and nothing beneath it. `orphan-sweep.ts` proves this
 *      exhaustively; this fixture is the eyeball version.
 *   2. **Split head groups.** A role's title, company, dates and summary are one
 *      `wrap={false}` block and must never straddle a break.
 *   3. **The last page.** Five pages of dense content ending in a page that is
 *      90% white is the failure this fixture is most likely to expose.
 *
 * Nothing here is intended to look good. It is intended to fail loudly if the
 * page-break policy in src/ResumePdf.tsx stops working.
 */
export const maximalResumeFixture: ResumePdfProps = {
  ...resumeFixture,
  resume: {
    ...resumeFixture.resume,
    summary:
      'Principal engineer with a decade building the platforms other teams depend on — document automation, compliance, real-time auctions, and the delivery practice around all three. I work end to end: the architecture, the delivery, and the people around both, which in practice means I am as often in a hiring loop or an incident review as I am in an editor. For the last two years that has meant running agents in the loop every day, measuring what they actually change about throughput and defect rate, and publishing the numbers — which is why the figures on this site are measured rather than claimed.',
    experience: longResumeFixture.resume.experience.map((role, i) => ({
      ...role,
      // Three lines of role summary rather than one or two, so every head group
      // is at the top of its permitted size and `minPresenceAhead` has to work
      // against the tallest atomic block the document can produce.
      summary: `${role.summary} Accountable to the executive for the technical direction of the portfolio, the delivery standards applied to it, and the engineering practice that maintains both across a distributed team.`,
      // Seven to eight highlights, several of which wrap to two lines. Highlight
      // lists are the one thing allowed to span a break, so this is also the
      // check that a *split* list still reads as one list.
      highlights: [
        ...role.highlights,
        `Ran the quarterly architecture review for the ${i + 2} services owned by this team, including the deprecation path for the two that were retired`,
        'Wrote and maintained the ADR set the team still works from, and the decision log that sits under it',
        'Represented engineering in commercial conversations where the technical constraint was the negotiating position',
      ],
    })),
    capabilities: [
      ...longResumeFixture.resume.capabilities,
      'Performance engineering: profiling, budget setting, and regression gates in CI',
      'Accessibility to WCAG 2.2 AA, including audit and remediation planning',
      'Data privacy and residency constraints in regulated Australian markets',
      'Interviewing, levelling and calibration across an engineering organisation',
    ],
    education: [
      ...longResumeFixture.resume.education,
      {
        institution: 'Amazon Web Services',
        credential: 'Solutions Architect — Professional',
        start: '2021',
        end: '2024',
      },
    ],
  },
};

/**
 * The lower bound: a graduate's résumé with the strip switched off.
 *
 * This is the case that collapses rather than overflows, and it is the one the
 * layout is least likely to have been designed for. One role, three highlights,
 * three capabilities, **no education at all**, and `embedGitStats: false`.
 *
 * `education: []` is the specific thing to watch. `ResumePdf.tsx` renders the
 * EDUCATION `SectionHead` unconditionally and then maps over the array, so an
 * empty array prints a heading with a hairline and nothing under it — a section
 * that announces itself and then says nothing. Whether that is what happens is
 * exactly what this fixture is for; if it does, the heading needs the same
 * `resume.education.length > 0` guard the live strip gets from `embedGitStats`.
 *
 * The second thing to watch is the page as a whole. With no strip and one role
 * the document is roughly a third of a page of content on an A4 sheet, and the
 * question is whether the hierarchy still reads at that density or whether the
 * header simply floats above a void.
 */
export const minimalResumeFixture: ResumePdfProps = {
  ...resumeFixture,
  resume: {
    summary:
      'Software engineer, two years in. I build web applications end to end and I am looking for a team that reviews its own work carefully.',
    experience: [
      {
        company: 'Northbridge Systems',
        title: 'Software Engineer',
        start: '2024',
        end: 'Present',
        summary:
          'Feature work across a line-of-business application, with a growing share of the front-end surface.',
        highlights: [
          'Shipped the customer-facing reporting module',
          'Reduced the test suite from 40 minutes to 6',
          'Took the on-call rotation for the billing service',
        ],
      },
    ],
    capabilities: [
      'TypeScript and React',
      'PostgreSQL',
      'CI and release automation',
    ],
    // Deliberately empty. See this fixture's note.
    education: [],
    embedGitStats: false,
  },
};

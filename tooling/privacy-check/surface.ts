/**
 * surface.ts — everything an unauthenticated stranger can read.
 *
 * ── Why raw HTTP and not ConvexHttpClient ──────────────────────────────────
 *
 * Two reasons, and the second is the important one.
 *
 * `tooling/*` is not a workspace (see the root package.json), so it has no
 * `node_modules` and `convex` is not hoisted to the repo root. The Collector
 * solved the same problem the same way: depend on nothing, use the platform.
 *
 * But the reason this is *right* rather than merely convenient is that the
 * threat model is a stranger with the deployment URL and `curl`. Convex's
 * `POST /api/query` is that stranger's exact capability, and it is public and
 * unauthenticated by design. Reaching for the SDK — or worse, for `convex run`,
 * which the seed tool uses and which authenticates with the deployment's **admin
 * key** — would test a different actor than the one ADR 008 is about. `convex
 * run` can read internal functions and would sail past an auth check that a real
 * visitor hits, which is precisely the bug this file must be able to see.
 *
 * So: no SDK, no credentials, no admin key. If it is readable from here, it is
 * readable from anywhere.
 */

/** One public response, captured for searching. */
export type Capture = {
  /** `module:function` plus a hint at the args, for the report. */
  label: string;
  /** The response body as text — searched literally. */
  text: string;
  /** Convex's status: a rejected query is a *finding of its own* when it should have been allowed, and a pass when it should have been rejected. */
  status: 'success' | 'error';
};

/** `POST /api/query`, unauthenticated. */
async function query(
  base: string,
  path: string,
  args: Record<string, unknown>,
): Promise<{ status: 'success' | 'error'; value: unknown; text: string }> {
  const response = await fetch(`${base}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  const text = await response.text();
  let parsed: { status?: string; value?: unknown } = {};
  try {
    parsed = JSON.parse(text) as { status?: string; value?: unknown };
  } catch {
    // A non-JSON body is still searched — it is still bytes a stranger received.
    return { status: 'error', value: null, text };
  }
  return {
    status: parsed.status === 'success' ? 'success' : 'error',
    value: parsed.value ?? null,
    // Search the *value*, not the envelope: an error envelope echoes the
    // function name back, which would otherwise self-match on a module called
    // e.g. `projects`.
    text: parsed.status === 'success' ? JSON.stringify(parsed.value) : text,
  };
}

/** Slugs found in a list response, so `getBySlug` can be swept rather than guessed. */
function slugsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const row of value) {
    if (row !== null && typeof row === 'object' && 'slug' in row) {
      const slug = (row as { slug: unknown }).slug;
      if (typeof slug === 'string') out.push(slug);
    }
  }
  return out;
}

export type Surface = {
  captures: Capture[];
  /** Queries that answered a stranger when they arguably should not have. */
  authFindings: string[];
  /** Published slugs, which double as the ADR 008 sanction list (see repos.ts). */
  publishedNames: string[];
};

/**
 * Read every public query an anonymous caller can reach.
 *
 * The zero-argument queries are swept first; their responses supply the slugs
 * for the per-slug queries, so this follows the site's own link graph rather
 * than a hardcoded list that would silently stop covering new content.
 */
export async function readPublicSurface(base: string): Promise<Surface> {
  const captures: Capture[] = [];
  const authFindings: string[] = [];
  const publishedNames: string[] = [];

  const capture = async (label: string, path: string, args: Record<string, unknown> = {}) => {
    const result = await query(base, path, args);
    captures.push({ label, text: result.text, status: result.status });
    return result;
  };

  /* ---- the site's own reads ---------------------------------------- */

  await capture('snapshot:get', 'snapshot:get');
  await capture('resume:get', 'resume:get');
  await capture('siteSettings:get', 'siteSettings:get');
  await capture('experienceEntries:list', 'experienceEntries:list');
  await capture('funEntries:list', 'funEntries:list');
  await capture('posts:list', 'posts:list');
  await capture('projects:listFeatured', 'projects:listFeatured');
  await capture('labs:listFeatured', 'labs:listFeatured');

  const projects = await capture('projects:list', 'projects:list');
  const labs = await capture('labs:list', 'labs:list');
  const posts = await capture('posts:list (slugs)', 'posts:list');

  for (const row of [projects.value, labs.value].flatMap((v) => (Array.isArray(v) ? v : []))) {
    if (row !== null && typeof row === 'object') {
      for (const key of ['slug', 'title'] as const) {
        const v = (row as Record<string, unknown>)[key];
        if (typeof v === 'string') publishedNames.push(v);
      }
    }
  }

  /* ---- per-slug detail pages --------------------------------------- */

  for (const slug of slugsOf(projects.value)) {
    await capture(`projects:getBySlug ${slug}`, 'projects:getBySlug', { slug });
  }
  for (const slug of slugsOf(labs.value)) {
    await capture(`labs:getBySlug ${slug}`, 'labs:getBySlug', { slug });
  }
  for (const slug of slugsOf(posts.value)) {
    await capture(`posts:getBySlug ${slug}`, 'posts:getBySlug', { slug });
  }

  /* ---- the probes ---------------------------------------------------
   *
   * Unpublished rows are the highest-risk content on the deployment: a draft
   * case study is by definition text that has not been through the ADR 009
   * sanitisation pass. `includeDrafts` is a *public* argument on two list
   * queries, so "does the server check who is asking, or does it just believe
   * the flag?" is a question with a one-request answer.
   * ------------------------------------------------------------------ */

  for (const [label, path] of [
    ['projects:list', 'projects:list'],
    ['labs:list', 'labs:list'],
  ] as const) {
    const result = await capture(`${label} includeDrafts=true`, path, { includeDrafts: true });
    if (result.status === 'success') {
      const rows = Array.isArray(result.value) ? result.value : [];
      const drafts = rows.filter(
        (r) => r !== null && typeof r === 'object' && (r as { published?: unknown }).published === false,
      );
      if (drafts.length > 0) {
        authFindings.push(
          `${label} returned ${drafts.length} unpublished row(s) to an anonymous caller with includeDrafts=true`,
        );
      }
    }
  }

  /* ---- surfaces that must reject a stranger outright ---------------- */

  for (const [label, path] of [
    ['contactMessages:list', 'contactMessages:list'],
    ['contactMessages:counts', 'contactMessages:counts'],
    ['ingestTokens:list', 'ingestTokens:list'],
  ] as const) {
    const result = await capture(`${label} (must reject)`, path);
    if (result.status === 'success') {
      authFindings.push(`${label} answered an anonymous caller instead of rejecting it`);
    }
  }

  return { captures, authFindings, publishedNames };
}

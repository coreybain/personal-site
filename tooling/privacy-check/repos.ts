/**
 * repos.ts — build the corpus of names that must never appear in public.
 *
 * ADR 008 is the rule this file encodes the *input* to: "Private repos are never
 * named, no repo links, no commit detail." To test that assertion you first have
 * to know what the private names actually are, and there are two independent
 * sources for them. The check uses both, because each one catches leaks the
 * other cannot:
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EVERY NAME IN THIS FILE'S COMMENTS IS INVENTED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `personal-site` is a **public** repository, so this source file is published
 * the moment it is committed — and a tool whose job is to stop private repo
 * names reaching the public internet must not be the thing that carries them
 * there. Nothing here is load-bearing: the corpus is built live from `gh api`
 * and from `~/GitHub` at run time, so no real name has to be written down for
 * the check to work. The illustrations below (`acme-corp/client-app-v2`,
 * `client-app-deploy`, `client-app copy 2`, `internal-tool`, …) are fabricated
 * stand-ins chosen to have the same *shape* as the real things.
 *
 *   1. **`~/GitHub` on this Mac** — the working copies. This is the source the
 *      task named, and it is the one that matters for Pipeline 2: the Collector
 *      walks `~/.claude/projects`, whose directory names are path-encoded
 *      working-copy paths (`-Users-coreybaines-GitHub-client-app-v2`). A
 *      Collector regression leaks a *directory name*, not a GitHub name, and for
 *      several repos here the two differ — a checkout called
 *      `client-app-deploy` on disk can be `acme-corp/client-app-v2` on GitHub,
 *      and a stray `client-app copy 2` is a directory name that exists nowhere
 *      else in the world.
 *
 *   2. **Every private repo the PAT can see** (`GET /user/repos`, all
 *      affiliations). This is the source that matters for Pipeline 1: the git
 *      action asks GitHub for contribution data and gets back repositories that
 *      were never cloned to this machine. 137 of them at the time of writing
 *      against ~20 private working copies, so the local directory alone would
 *      test roughly a seventh of the real exposure.
 *
 * ── The awkward part: some private repo names are *required* to be public ──
 *
 * ADR 008 does not say "no client names". It says the opposite — "aggregate
 * totals **and named CI projects**", "Named case studies only, as the current
 * site already does". The case studies are QuoteCloud, TravelDocs, ZeroRisk,
 * SoldOnline and Visual Editor, and each of those is *also* the name of a
 * private repository. A
 * naive grep for private repo names therefore fails on a correct site, which is
 * the kind of check that gets deleted within a week.
 *
 * So the distinction this file draws, and it is the same one ADR 008 draws:
 *
 *   • A **repository identifier** — `owner/name`, or a github.com URL to one —
 *     is never permitted for a private repo. Not for QuoteCloud either. That is
 *     "no repo links", and it is unconditional.
 *   • A **bare product name** is permitted exactly when the site has published a
 *     case study or lab under that name. Publishing is the sanctioning act: it
 *     is a hand-written, hand-reviewed row (phase 8), not something a pipeline
 *     can do on its own. Every unpublished client build — the ones this file
 *     will not name, standing in here as `internal-tool`, `client-portal`,
 *     `retail-cms`, `ops-console` — is a leak.
 *
 * The sanctioned list is therefore read from the deployment at check time rather
 * than hardcoded here, so that adding a case study does not require editing this
 * tool, and so that the tool cannot quietly grant an exemption the site never
 * actually published.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** One name that must not appear in public, and where it came from. */
export type PrivateName = {
  /** The literal text to search for. */
  value: string;
  /**
   * `identifier` — an `owner/name` pair or a URL to one. Never permitted.
   * `name` — a bare repository name. Permitted only if published as a case
   * study or lab (see the header).
   * `directory` — a working-copy directory name on this Mac. Never permitted:
   * nothing on the public site has any reason to know what Corey's folders are
   * called, and this is the exact string the Collector could leak.
   */
  kind: 'identifier' | 'name' | 'directory';
  /** Human-readable provenance, printed on a finding. */
  source: string;
};

/**
 * Names too generic to test, with the reason each one is here.
 *
 * Every entry is a real private repository, and dropping it costs real coverage.
 * They are dropped anyway because each is an ordinary English or web-development
 * word that appears on a site about building software for reasons that have
 * nothing to do with the repository — matching them would produce a permanently
 * red check, and a permanently red check is an ignored check.
 *
 * These *values* are unavoidably real, and they are the one place in this file
 * where that is acceptable: they are dictionary words, they carry no owner, and
 * a reader learns nothing from `server` that they did not already know. The
 * provenance comments are deliberately generic for the reason in the header —
 * `owner/name` is the disclosure, and it is not written down here.
 *
 * The cost is bounded and worth stating plainly: if a leak ever consists of
 * *only* one of these words, this tool will not catch it. Every such repo sits
 * under a client org prefix and would in practice leak alongside it, which is
 * tested as an `identifier`.
 */
const TOO_GENERIC = new Set([
  'client', // a client-org repo with a generic name
  'server', // a client-org repo with a generic name — also "server component"
  'website', // a client-org repo with a generic name
  'webapp', // a client-org repo with a generic name
  'cms', // a client-org repo with a generic name
  'home', // the repo this site was planned into (ADR 001)
  'payload', // a local working copy; also the ingest payload, everywhere
  'countries', // a local working copy
  'unsplash', // a private repo of Corey's own; image credits name Unsplash legitimately
  // Not a private repo at all: `~/GitHub/Spiritdevs` is a remote-less folder
  // named after a *public* GitHub org and a live public website
  // (spiritdevs.com — ADR 017 redirects it, it does not hide it). The string is
  // public by construction and appears in Corey's own contact email, so the
  // directory of the same name carries no private information to protect.
  'spiritdevs',
]);

/** `owner/name` for the repo a working copy points at, or `null` if it has no remote. */
function remoteOf(dir: string): string | null {
  try {
    const config = readFileSync(join(dir, '.git', 'config'), 'utf8');
    // Deliberately a text scan rather than `git config`: this must not execute
    // anything inside a directory it is only meant to be reading about.
    const match = config.match(/url\s*=\s*\S*github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\s/);
    if (match === null) return null;
    return `${match[1]}/${match[2]}`;
  } catch {
    return null;
  }
}

/** Every private repository the PAT can see, as `owner/name`. */
async function privateReposFromGitHub(): Promise<string[]> {
  const proc = Bun.spawn(
    [
      'gh',
      'api',
      '--method',
      'GET',
      'user/repos?affiliation=owner,collaborator,organization_member&per_page=100',
      '--paginate',
      '--jq',
      '.[] | select(.private==true) | .full_name',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const out = await new Response(proc.stdout).text();
  const status = await proc.exited;
  if (status !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`gh api failed (${status}): ${err.trim()}`);
  }
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The working copies on this Mac, and the private repos each points at.
 *
 * A directory with no git remote still contributes its *directory name*: the
 * Collector keys on the directory, so an un-pushed local experiment is still a
 * name that must not appear on the public internet.
 */
function localWorkingCopies(root: string): { dir: string; remote: string | null }[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => {
      try {
        return statSync(join(root, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((entry) => ({ dir: entry, remote: remoteOf(join(root, entry)) }));
}

/** Everything that must not appear in a public response. */
export type Corpus = {
  names: PrivateName[];
  /** Counts, for the report header. */
  stats: {
    privateReposOnGitHub: number;
    localDirectories: number;
    localPrivate: number;
    skippedAsGeneric: number;
  };
};

export async function buildCorpus(reposRoot: string = join(homedir(), 'GitHub')): Promise<Corpus> {
  const privateFullNames = await privateReposFromGitHub();
  const privateSet = new Set(privateFullNames.map((n) => n.toLowerCase()));
  const local = localWorkingCopies(reposRoot);

  const names: PrivateName[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  const add = (value: string, kind: PrivateName['kind'], source: string): void => {
    const key = `${kind}:${value.toLowerCase()}`;
    if (seen.has(key)) return;
    if (kind !== 'identifier' && TOO_GENERIC.has(value.toLowerCase())) {
      skipped += 1;
      return;
    }
    seen.add(key);
    names.push({ value, kind, source });
  };

  for (const fullName of privateFullNames) {
    add(fullName, 'identifier', 'private repo on GitHub');
    const bare = fullName.split('/')[1]!;
    add(bare, 'name', `private repo ${fullName}`);
  }

  let localPrivate = 0;
  for (const { dir, remote } of local) {
    const isPrivate = remote !== null && privateSet.has(remote.toLowerCase());
    if (isPrivate) localPrivate += 1;

    // A directory name is only sensitive when it names private work. Public
    // working copies (`personal-site`, `uninstally`) are already on the public
    // internet under exactly that name.
    if (isPrivate || remote === null) {
      add(dir, 'directory', remote === null ? `local dir ${dir} (no remote)` : `local dir for ${remote}`);
    }
    if (remote !== null && isPrivate) {
      add(remote, 'identifier', `local working copy ${dir}`);
    }
  }

  return {
    names,
    stats: {
      privateReposOnGitHub: privateFullNames.length,
      localDirectories: local.length,
      localPrivate,
      skippedAsGeneric: skipped,
    },
  };
}

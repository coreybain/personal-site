/**
 * schema.ts — the schema.org vocabulary this site actually speaks, as types and
 * as the two nodes every page's graph refers back to.
 *
 * ── No `schema-dts` ────────────────────────────────────────────────────────
 *
 * The obvious dependency for typing JSON-LD is `schema-dts`, and Next's guide
 * names it. It is not installed, for two reasons and neither is bundle size (it
 * is types-only and weighs nothing at runtime):
 *
 *   1. This site emits **four** types — Person, WebSite, ProfilePage,
 *      CollectionPage, Article. A 3 MB union of every term in the vocabulary to
 *      check five object literals is a poor trade, and the failure it prevents
 *      (a misspelt property) is caught just as well by the builders below being
 *      the only way to construct a node.
 *   2. Adding it would mean touching `bun.lock`, which is shared with agents
 *      running in parallel on this phase.
 *
 * The shapes below are therefore structural rather than nominal: they enforce
 * that a document is serialisable and carries a `@context` and a `@type`, and
 * the *correctness* of the vocabulary is enforced by validation against
 * schema.org's own validator, which is the only thing that can check it anyway.
 *
 * ── Stable `@id`s, and why they matter ─────────────────────────────────────
 *
 * Every page's graph refers to the same person by the same URI. Without that,
 * a crawler reading /, /resume, /work and three posts sees six unrelated people
 * who happen to share a name. `PERSON_ID` and `WEBSITE_ID` are those URIs; they
 * are fragments on the production origin (ADR 017) so they are stable across
 * previews, and they are *node identifiers*, not fetchable documents — the
 * fragment is what tells a consumer so.
 */

import portrait from "@/assets/portrait.jpg";
import type { Identity } from "@/lib/snapshot";
import { absoluteUrl, SITE_URL } from "@/lib/seo";

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

/** Anything `JSON.stringify` will render as a JSON value, and nothing else. */
export type JsonLdValue =
  | string
  | number
  | boolean
  | JsonLdObject
  | readonly JsonLdValue[];

export interface JsonLdObject {
  readonly [key: string]: JsonLdValue | undefined;
}

/** A node inside a graph: typed, and optionally identified. */
export type JsonLdNode = JsonLdObject & { readonly "@type": string };

/**
 * A complete document, ready for a `<script>` tag.
 *
 * `@context` is required at the top level and nowhere else — a nested node
 * inherits it, and repeating it is noise a validator will not thank you for.
 */
export type JsonLdDocument = JsonLdObject & {
  readonly "@context": "https://schema.org";
};

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

/** The one Corey. Referred to by `{ "@id": PERSON_ID }` from every other page. */
export const PERSON_ID = `${SITE_URL}/#person`;

/** The site as a work, distinct from the homepage as a document. */
export const WEBSITE_ID = `${SITE_URL}/#website`;

/**
 * A reference to a node declared in full **on the same page** — a bare `@id`,
 * no `@type`, no properties.
 *
 * Correct only when the full node is in the same graph, because that is the
 * only case where a consumer can resolve it in one parse. /resume qualifies:
 * it declares the Person and then points `about` and `mainEntity` at it.
 *
 * For a cross-page reference use `personStub` / `websiteStub` below.
 */
export function idRef(id: string): JsonLdObject {
  return { "@id": id };
}

/**
 * A reference to the Person from a page that does **not** declare it.
 *
 * ── Why a stub and not a bare `@id` ────────────────────────────────────────
 *
 * A blog post's `author` is the textbook case. Linked data says a bare `@id` is
 * enough — the node is described elsewhere at that URI and a graph is a graph.
 * Consumers do not work that way: Google's Article requirements state the
 * author must have a `name`, and it evaluates one page at a time, so
 * `author: { "@id": … }` alone reads as an author with no name and the whole
 * annotation is discarded.
 *
 * The stub is the resolution: enough properties to stand alone on the page that
 * carries it, and the *same* `@id` as the full node on `/` and `/resume`, so
 * anything that does merge across pages merges these rather than inventing a
 * second person. That is what `@id` is for — the properties are a restatement,
 * never a contradiction.
 */
export function personStub(identity: Identity): JsonLdNode {
  return {
    "@type": "Person",
    "@id": PERSON_ID,
    name: identity.name,
    url: absoluteUrl("/"),
  };
}

/** The same idea for the site itself, used by `isPartOf` on every inner page. */
export function websiteStub(identity: Identity): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: `${identity.name} — ${identity.role}`,
    url: absoluteUrl("/"),
  };
}

/* ------------------------------------------------------------------ *
 * Shared nodes
 * ------------------------------------------------------------------ */

/**
 * Every profile the site links to, as `sameAs`.
 *
 * This is the property that does the real work in a Person graph: it is how a
 * consumer decides that the `coreybain` on GitHub, the profile on LinkedIn and
 * the page it is currently reading are one entity. Only URLs already rendered
 * as links in the site's own footer appear here — structured data is a
 * restatement of the page, never an addition to it.
 *
 * `github` is stored as a bare handle and expanded; the other two are stored as
 * full URLs. Empty values are dropped rather than emitted as broken URLs.
 */
export function socialProfiles(identity: Identity): string[] {
  return [
    identity.github ? `https://github.com/${identity.github}` : null,
    identity.linkedin || null,
    identity.x || null,
  ].filter((url): url is string => url !== null);
}

/**
 * `"Sydney, Australia"` → a `PostalAddress`.
 *
 * Split on the **last** comma so a three-part location ("Pyrmont, Sydney,
 * Australia") still yields the right country. A value with no comma at all
 * becomes locality-only, which is honest: inventing a country from one token is
 * how structured data starts disagreeing with the page it describes.
 */
export function postalAddress(location: string): JsonLdNode {
  const cut = location.lastIndexOf(",");

  if (cut === -1) {
    return { "@type": "PostalAddress", addressLocality: location.trim() };
  }

  return {
    "@type": "PostalAddress",
    addressLocality: location.slice(0, cut).trim(),
    addressCountry: location.slice(cut + 1).trim(),
  };
}

/**
 * The Person node, in full. Declared **once per page** at most, and only on the
 * two pages that are actually about the person: the homepage and /resume.
 * Everywhere else refers to it by `idRef(PERSON_ID)`.
 *
 * `jobTitle` is the role and `worksFor` is the employer, which together are the
 * claim this whole site exists to support (ADR 017: an individual principal
 * engineer, not an agency). `email` is not a new disclosure — the footer, the
 * contact page and the resume all render it as a `mailto:` already.
 *
 * `description` is the caller's, because what to say about the person differs
 * by page: the homepage has live telemetry to quote, /resume has years shipping.
 */
export function personNode(
  identity: Identity,
  description: string,
): JsonLdNode {
  return {
    "@type": "Person",
    "@id": PERSON_ID,
    name: identity.name,
    url: absoluteUrl("/"),
    /**
     * The same portrait `<PersonalCard>` renders. `.src` is the content-hashed
     * path Next assigns the asset at build; prefixing it with the production
     * origin makes it the absolute URL the vocabulary requires, and it stays
     * correct because both halves are derived rather than typed.
     */
    image: absoluteUrl(portrait.src),
    jobTitle: identity.role,
    description,
    email: `mailto:${identity.email}`,
    address: postalAddress(identity.location),
    worksFor: { "@type": "Organization", name: identity.company },
    knowsAbout: [
      "Software architecture",
      "Platform engineering",
      "Distributed systems",
      "AI-assisted software delivery",
    ],
    sameAs: socialProfiles(identity),
  };
}

/**
 * The WebSite node. Declared once, on the homepage.
 *
 * No `potentialAction` / `SearchAction`: the site has no search endpoint, and
 * declaring one that does not exist is the most common way a sitelinks
 * searchbox annotation gets a page penalised rather than promoted.
 */
export function websiteNode(
  identity: Identity,
  description: string,
): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: absoluteUrl("/"),
    name: `${identity.name} — ${identity.role}`,
    description,
    inLanguage: "en-AU",
    author: idRef(PERSON_ID),
    publisher: idRef(PERSON_ID),
    copyrightHolder: idRef(PERSON_ID),
  };
}

/**
 * Wrap a set of nodes as one document.
 *
 * `@graph` rather than one `<script>` per node: it is the shape that lets nodes
 * cross-reference by `@id` inside a single parse, and it keeps a page to exactly
 * one structured-data block, which is easier to read in view-source and easier
 * to reason about when something is wrong.
 */
export function graph(...nodes: JsonLdNode[]): JsonLdDocument {
  return { "@context": "https://schema.org", "@graph": nodes };
}

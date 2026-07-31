/**
 * The site's structured data, in one folder.
 *
 * Four page-level components and the primitive they share. Each is a Server
 * Component that takes data the page has **already read** — none of them fetch,
 * so adding structured data to a page costs zero Convex queries and zero bytes
 * of client JavaScript.
 *
 *   HomeJsonLd     Person + WebSite            /
 *   WorkJsonLd     CollectionPage + ItemList   /work
 *   ProfileJsonLd  ProfilePage + Person        /resume
 *   ArticleJsonLd  Article                     /blog/[slug]
 *
 * `schema.ts` holds the vocabulary: the `@id`s every graph refers back to, the
 * Person and WebSite node builders, and the types. Read its header before
 * adding a fifth type.
 */

export { ArticleJsonLd } from "./ArticleJsonLd";
export { HomeJsonLd } from "./HomeJsonLd";
export { JsonLd } from "./JsonLd";
export { ProfileJsonLd } from "./ProfileJsonLd";
export { WorkJsonLd } from "./WorkJsonLd";
export { PERSON_ID, WEBSITE_ID } from "./schema";
export type { JsonLdDocument, JsonLdNode } from "./schema";

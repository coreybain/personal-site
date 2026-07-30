/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as contactMessages from "../contactMessages.js";
import type * as experienceEntries from "../experienceEntries.js";
import type * as funEntries from "../funEntries.js";
import type * as ingestTokens from "../ingestTokens.js";
import type * as labs from "../labs.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_validate from "../lib/validate.js";
import type * as posts from "../posts.js";
import type * as projects from "../projects.js";
import type * as resume from "../resume.js";
import type * as siteSettings from "../siteSettings.js";
import type * as snapshot from "../snapshot.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  contactMessages: typeof contactMessages;
  experienceEntries: typeof experienceEntries;
  funEntries: typeof funEntries;
  ingestTokens: typeof ingestTokens;
  labs: typeof labs;
  "lib/auth": typeof lib_auth;
  "lib/validate": typeof lib_validate;
  posts: typeof posts;
  projects: typeof projects;
  resume: typeof resume;
  siteSettings: typeof siteSettings;
  snapshot: typeof snapshot;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

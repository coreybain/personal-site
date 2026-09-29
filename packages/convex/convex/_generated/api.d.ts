/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alerts from "../alerts.js";
import type * as ask from "../ask.js";
import type * as contactMessages from "../contactMessages.js";
import type * as crons from "../crons.js";
import type * as experienceEntries from "../experienceEntries.js";
import type * as funEntries from "../funEntries.js";
import type * as gitStats from "../gitStats.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as ingestTokens from "../ingestTokens.js";
import type * as knowledge from "../knowledge.js";
import type * as labs from "../labs.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_days from "../lib/days.js";
import type * as lib_labOperations from "../lib/labOperations.js";
import type * as lib_managementAuth from "../lib/managementAuth.js";
import type * as lib_managementValidation from "../lib/managementValidation.js";
import type * as lib_managementWrites from "../lib/managementWrites.js";
import type * as lib_postOperations from "../lib/postOperations.js";
import type * as lib_postSchedule from "../lib/postSchedule.js";
import type * as lib_projectOperations from "../lib/projectOperations.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_revision from "../lib/revision.js";
import type * as lib_validate from "../lib/validate.js";
import type * as managementHttp from "../managementHttp.js";
import type * as managementLabs from "../managementLabs.js";
import type * as managementPosts from "../managementPosts.js";
import type * as managementProjects from "../managementProjects.js";
import type * as managementReads from "../managementReads.js";
import type * as managementReceipts from "../managementReceipts.js";
import type * as managementTokens from "../managementTokens.js";
import type * as migrations from "../migrations.js";
import type * as postSchedule from "../postSchedule.js";
import type * as posts from "../posts.js";
import type * as preview from "../preview.js";
import type * as previewAccess from "../previewAccess.js";
import type * as projects from "../projects.js";
import type * as repoMap from "../repoMap.js";
import type * as resume from "../resume.js";
import type * as seed from "../seed.js";
import type * as siteCache from "../siteCache.js";
import type * as siteSettings from "../siteSettings.js";
import type * as snapshot from "../snapshot.js";
import type * as snapshotBuild from "../snapshotBuild.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alerts: typeof alerts;
  ask: typeof ask;
  contactMessages: typeof contactMessages;
  crons: typeof crons;
  experienceEntries: typeof experienceEntries;
  funEntries: typeof funEntries;
  gitStats: typeof gitStats;
  http: typeof http;
  ingest: typeof ingest;
  ingestTokens: typeof ingestTokens;
  knowledge: typeof knowledge;
  labs: typeof labs;
  "lib/auth": typeof lib_auth;
  "lib/days": typeof lib_days;
  "lib/labOperations": typeof lib_labOperations;
  "lib/managementAuth": typeof lib_managementAuth;
  "lib/managementValidation": typeof lib_managementValidation;
  "lib/managementWrites": typeof lib_managementWrites;
  "lib/postOperations": typeof lib_postOperations;
  "lib/postSchedule": typeof lib_postSchedule;
  "lib/projectOperations": typeof lib_projectOperations;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/revision": typeof lib_revision;
  "lib/validate": typeof lib_validate;
  managementHttp: typeof managementHttp;
  managementLabs: typeof managementLabs;
  managementPosts: typeof managementPosts;
  managementProjects: typeof managementProjects;
  managementReads: typeof managementReads;
  managementReceipts: typeof managementReceipts;
  managementTokens: typeof managementTokens;
  migrations: typeof migrations;
  postSchedule: typeof postSchedule;
  posts: typeof posts;
  preview: typeof preview;
  previewAccess: typeof previewAccess;
  projects: typeof projects;
  repoMap: typeof repoMap;
  resume: typeof resume;
  seed: typeof seed;
  siteCache: typeof siteCache;
  siteSettings: typeof siteSettings;
  snapshot: typeof snapshot;
  snapshotBuild: typeof snapshotBuild;
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

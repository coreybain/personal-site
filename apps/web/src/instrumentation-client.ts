import { initBotId } from "botid/client/core";

/**
 * Server Actions POST back to the page that invoked them, rather than to a
 * dedicated API URL. The shared contact sheet is available on every route
 * below, so each current public page path must participate in the BotID
 * challenge. Wildcards cover the two dynamic content routes.
 *
 * The sign-in entries protect the first-party verification action that gates
 * Clerk's UI. Clerk continues to protect its own credential endpoints.
 */
const protectedRoutes = [
  { path: "/", method: "POST" },
  { path: "/blog", method: "POST" },
  { path: "/blog/*", method: "POST" },
  { path: "/contact", method: "POST" },
  { path: "/fun", method: "POST" },
  { path: "/labs", method: "POST" },
  { path: "/resume", method: "POST" },
  { path: "/work", method: "POST" },
  { path: "/work/*", method: "POST" },
  { path: "/admin/sign-in", method: "POST" },
  { path: "/admin/sign-in/*", method: "POST" },
];

try {
  initBotId({ protect: protectedRoutes });
} catch (error) {
  // Instrumentation must never prevent the application from hydrating. The
  // server checks fail closed if BotID cannot classify a protected request.
  console.error(
    "[botid] Client instrumentation failed.",
    error instanceof Error ? error.message : "Unknown error",
  );
}

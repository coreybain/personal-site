/**
 * Server-side allowlist for the site's single human administrator.
 *
 * Clerk proves who a caller is. This value decides whether that identity may
 * use the one remaining Clerk-authenticated route, the iOS image upload
 * (`/api/native/upload`). The browser admin that also used it is gone. Keeping those two decisions separate
 * means an accidentally enabled public sign-up cannot grant site-wide write
 * access.
 */
export function configuredAdminClerkUserId(): string | null {
  const value = process.env.ADMIN_CLERK_USER_ID?.trim();
  return value ? value : null;
}

export function isConfiguredAdminClerkUser(userId: string | null): boolean {
  const configured = configuredAdminClerkUserId();
  return configured !== null && userId === configured;
}

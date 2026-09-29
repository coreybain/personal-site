import { signOut } from "@/app/(site)/preview/actions";

/** Signs this browser out. `revoke_preview_sessions` (MCP) signs out every browser. */
export function PreviewSignOut() {
  return (
    <form action={signOut}>
      <button type="submit" className="hor-btn hor-btn-ghost">Sign out</button>
    </form>
  );
}

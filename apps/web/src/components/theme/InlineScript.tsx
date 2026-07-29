/**
 * A `<script>` that runs synchronously while the browser parses the HTML —
 * i.e. before first paint, and long before React hydrates.
 *
 * Two details make this safe inside the App Router:
 *
 * 1. `type` is `text/javascript` on the server and `text/plain` on the client.
 *    Scripts inserted by a DOM update never execute anyway, so on client-side
 *    navigations this is inert — and React stops warning about rendering
 *    `<script>` during a client render.
 * 2. `suppressHydrationWarning` covers the resulting `type` mismatch.
 *
 * Only ever pass literal, developer-authored code here. Nothing user-supplied.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

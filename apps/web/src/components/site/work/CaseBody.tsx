/**
 * The optional long-form case-study narrative.
 *
 * `html` has already passed through the same server-only Markdown pipeline used
 * by blog posts. That pipeline discards raw HTML and sanitises the generated
 * tree before this component receives it. Project bodies are admin-authored,
 * never visitor submissions, and this component adds no client JavaScript.
 */
export function CaseBody({ html }: { html: string }) {
  if (html.length === 0) return null;

  return (
    <section className="work-body pb-16 sm:pb-20" aria-label="Project details">
      <div
        className="work-prose"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  );
}

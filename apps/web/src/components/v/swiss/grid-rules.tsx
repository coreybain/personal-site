/** The exposed grid: 4 columns under 768px, 12 above. Decorative only. */
export function GridRules() {
  return (
    <div className="sw-rules" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <i key={i} className={i >= 4 ? "hidden md:block" : undefined} />
      ))}
    </div>
  );
}

/**
 * The night sky. Four wide, heavily blurred gradient blobs drifting behind the
 * glass on a 68–104 second cycle — slow enough that you notice it only if you
 * stop and look. Fixed to the viewport, painted below everything, inert to
 * pointers, and entirely CSS: no JS, no canvas, no images.
 *
 * Sits INSIDE <ThemeScope> so its colours resolve from `--noc-blob-*`.
 */
export function Backdrop() {
  return (
    <div className="noc-backdrop" aria-hidden="true">
      <div className="noc-blob noc-blob-1" />
      <div className="noc-blob noc-blob-2" />
      <div className="noc-blob noc-blob-3" />
      <div className="noc-blob noc-blob-4" />
      <div className="noc-grain" />
    </div>
  );
}

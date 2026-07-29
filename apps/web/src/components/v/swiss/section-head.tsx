export function SectionHead({
  index,
  label,
  note,
}: {
  index: string;
  label: string;
  note?: string;
}) {
  return (
    <div className="sw-head">
      <span className="sw-mono sw-red">{index}</span>
      <span className="sw-mono">{label}</span>
      {note ? (
        <span className="sw-mono sw-mute hidden text-right sm:block">
          {note}
        </span>
      ) : (
        <span />
      )}
    </div>
  );
}

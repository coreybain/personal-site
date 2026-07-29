import { group } from "./format";

export type LedgerRow = {
  label: string;
  value: number;
  /** Fraction of the group total, 0–1. Drives the bar width. */
  share: number;
  unit?: string;
  lead?: boolean;
};

export function Ledger({ rows }: { rows: LedgerRow[] }) {
  return (
    <ul>
      {rows.map((row) => (
        <li
          key={row.label}
          className="border-t border-[var(--sw-hair)] py-3.5 first:border-[var(--sw-ink)]"
        >
          <div className="flex items-baseline justify-between gap-4">
            <span className="sw-mono">{row.label}</span>
            <span className="flex items-baseline gap-1.5">
              <span className="sw-stat-num">{group(row.value)}</span>
              {row.unit ? (
                <span className="sw-mono sw-mute">{row.unit}</span>
              ) : null}
            </span>
          </div>
          <div className="sw-track mt-3">
            <div
              className={row.lead ? "sw-fill sw-fill-red" : "sw-fill"}
              style={{ width: `${Math.max(row.share * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

import styles from "./aurora.module.css";

export function SectionHeading({
  index,
  eyebrow,
  title,
  lede,
  aside,
}: {
  index: string;
  eyebrow: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 sm:mb-9">
      <div className="max-w-[36ch]">
        <span className={`${styles.eyebrow} flex items-center gap-2.5`}>
          <span className={styles.mono}>{index}</span>
          <span className="h-px w-6 bg-[var(--aur-hairline)]" aria-hidden="true" />
          {eyebrow}
        </span>
        <h2 className={`${styles.h2} mt-3.5 text-balance`}>{title}</h2>
        {lede ? (
          <p className={`${styles.label} mt-3 max-w-[42ch] text-pretty`}>{lede}</p>
        ) : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}

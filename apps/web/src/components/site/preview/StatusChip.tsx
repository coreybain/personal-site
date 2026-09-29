import type { PreviewListItem } from "@/lib/preview";
import { formatSydney } from "@/lib/sydneyTime";

/** A post's state in the preview list and bar, with any schedule in Sydney time. */
export function StatusChip({ post }: { post: Pick<PreviewListItem, "status" | "scheduledFor" | "scheduleFailure"> }) {
  const when = post.scheduledFor ? formatSydney(post.scheduledFor) : null;
  switch (post.status) {
    case "draft": return <span className="pv-chip">Draft</span>;
    case "scheduled": return <span className="pv-chip pv-chip-scheduled">Scheduled · {when}</span>;
    case "failed": return <span className="pv-chip pv-chip-failed">Scheduled — failed</span>;
    case "published": return <span className="pv-chip pv-chip-live">Live</span>;
    case "published_with_changes": return <span className="pv-chip pv-chip-live">Live · changes pending</span>;
    case "changes_scheduled": return <span className="pv-chip pv-chip-scheduled">Changes scheduled · {when}</span>;
    case "changes_failed": return <span className="pv-chip pv-chip-failed">Scheduled changes — failed</span>;
  }
}

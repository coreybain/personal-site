/**
 * alerts.ts — email to Corey about scheduled publishing, through Resend.
 *
 * Two messages: a scheduled post failed to publish, and a scheduled post went
 * live. Sent with Resend's HTTP API from an action (a mutation cannot fetch).
 *
 * Configuration, in the Convex deployment environment:
 *
 *   RESEND_API_KEY   a sending-only key; until it is set, alerts are skipped
 *                    and logged, and the preview list and MCP still show the
 *                    status
 *   ALERT_FROM       default "Personal site <alerts@spiritdevs.com>"
 *   ALERT_TO         default "corey@spiritdevs.com"
 *
 * The sending domain must be verified in the Resend account for ALERT_FROM to
 * be accepted.
 */
import { v } from 'convex/values';
import { internalAction } from './_generated/server';

const DEFAULT_FROM = 'Personal site <alerts@spiritdevs.com>';
const DEFAULT_TO = 'corey@spiritdevs.com';

export const scheduledPostAlert = internalAction({
  args: {
    kind: v.union(v.literal('published'), v.literal('failed')),
    title: v.string(),
    slug: v.string(),
    /** For `failed`: why it could not publish. */
    reason: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const key = process.env.RESEND_API_KEY?.trim();
    if (!key) {
      console.log(`[alerts] RESEND_API_KEY unset; skipped "${args.kind}" email for ${args.slug}.`);
      return { sent: false as const };
    }

    const origin = process.env.SITE_ORIGIN?.trim().replace(/\/+$/, '') ?? 'https://spiritdevs.com';
    const publicUrl = `${origin}/blog/${args.slug}`;
    const previewUrl = `${origin}/preview/blog/${args.slug}`;
    const subject = args.kind === 'published'
      ? `Published: ${args.title}`
      : `Scheduled post failed: ${args.title}`;
    const text = args.kind === 'published'
      ? `"${args.title}" went live on schedule.\n\n${publicUrl}\n`
      : `"${args.title}" could not be published on schedule, so it is still a draft.\n\nReason: ${args.reason ?? 'unknown'}\n\nReview it and reschedule: ${previewUrl}\n`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: process.env.ALERT_FROM?.trim() || DEFAULT_FROM,
        to: [process.env.ALERT_TO?.trim() || DEFAULT_TO],
        subject,
        text,
      }),
    });
    if (!response.ok) {
      // The body names the problem (unverified domain, bad key) without echoing the key.
      throw new Error(`Resend rejected the alert (HTTP ${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
    return { sent: true as const };
  },
});

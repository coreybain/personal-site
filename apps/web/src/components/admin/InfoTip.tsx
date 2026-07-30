"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

/**
 * A circled "i" that reveals a sentence or two on hover, focus or tap.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The admin used to print a paragraph of prose under every page title and a hint
 * under every field. All of it was true and almost none of it was being read: the
 * screens are used by one person who already knows what "Case studies" means, and
 * a wall of explanation above the thing you came to edit is a wall between you
 * and the thing you came to edit. So the prose moved in here. The rule for
 * deciding which text belongs in a tooltip and which stays on the page is in
 * `README.md` §Compact headers — the short version is that *chrome* text (what
 * this screen is, where the data comes from) becomes an InfoTip and *judgement*
 * text (a publish blocker, a token shown once, a destructive confirm) stays
 * inline and loud, because a fact you must act on cannot be behind a hover.
 *
 * ── Accessibility, and why each piece is the way it is ──────────────────────
 *
 *   - **The trigger is a real `<button type="button">`.** Not a `<span>` with a
 *     `title`, not an icon with a mouse handler. It is in the tab order, it has
 *     an accessible name, and it is operable by keyboard and by switch control.
 *
 *   - **The panel is always in the DOM**, hidden with `visibility` rather than
 *     `display: none`, and `aria-describedby` on the trigger points at it
 *     permanently. That is deliberate and it is the part that is easy to get
 *     wrong: per the accessible-name-and-description spec, a node that is hidden
 *     but *directly referenced* by `aria-describedby` is still included in the
 *     computed description. So a screen reader announces the explanation the
 *     moment the button takes focus, whether or not the panel is visible — the
 *     visual reveal is for sighted readers and nothing else. Rendering the panel
 *     only when open would mean the description exists only after a mouse event,
 *     which is to say only for people who do not need it.
 *
 *   - **No `aria-expanded`.** APG is explicit that a tooltip is not a
 *     disclosure: there is no expanded region to navigate into, and announcing
 *     one invites the reader to go looking for it. Visual state is `data-open`,
 *     which is a styling hook, not a promise to assistive tech.
 *
 *   - **Escape dismisses, from anywhere.** WCAG 1.4.13 (Content on Hover or
 *     Focus) requires additional content to be dismissable *without* moving the
 *     pointer or the focus — a hover tooltip that can only be closed by moving
 *     the mouse fails it, and a magnifier user who has the panel covering the
 *     text they were reading has no recourse. The listener is on `document`
 *     rather than on the trigger for exactly that case: when the panel is open
 *     because the mouse is resting on the icon, keyboard focus is somewhere else
 *     entirely, so a handler on the trigger would never fire.
 *
 *   - **Touch taps toggle.** Hover is opened only for `pointerType === "mouse"`.
 *     On a touchscreen a tap fires `pointerenter` *and then* `click`, so
 *     accepting hover from every pointer type would open on enter and
 *     immediately close on click — the classic "tooltips do not work on iPad"
 *     bug. Filtering by pointer type leaves `click` as the only path on touch,
 *     which makes it a clean toggle, and a tap outside closes it.
 *
 *   - **Focus reveals it visually only for keyboard focus.** `:focus-visible` is
 *     matched in JS rather than in CSS, which looks like the long way round.
 *     It is not: the reveal has to be *state* so that Escape can suppress it. A
 *     CSS `:focus-visible` rule cannot be dismissed — the selector keeps
 *     matching after the keypress — so it would silently fail 1.4.13 for the
 *     keyboard reader, who is the person the focus reveal is for.
 *
 * ── Positioning ─────────────────────────────────────────────────────────────
 *
 * The panel is `position: fixed` and placed from a measurement of the trigger.
 * Two reasons, both learned the hard way with absolutely-positioned tooltips:
 *
 *   1. An InfoTip in a table header sits inside `.adm-table-wrap`, which is
 *      `overflow-x: auto`. An absolutely-positioned panel is clipped by that
 *      container, or worse, extends it and adds a horizontal scrollbar to the
 *      table. Fixed positioning is not affected by an ancestor's overflow.
 *   2. "Near the viewport edge" is a question about the viewport, and with fixed
 *      positioning it is answered by comparing two numbers rather than by
 *      unwinding a chain of offset parents.
 *
 * The measurement is taken in the handler that opens the panel, *before* it
 * becomes visible, so there is no frame at the wrong coordinates. It can be
 * taken because the panel is only `visibility: hidden` and therefore still has a
 * box — which is the second reason for that choice.
 *
 * On the inline axis the panel is start-aligned with the trigger and then
 * **clamped** into the viewport rather than flipped. Clamping is the superset: a
 * hard flip to end-aligned still overflows when the trigger itself is within a
 * panel-width of the edge, which on a phone is most of them. On the block axis
 * it does flip — below the trigger normally, above when below does not fit and
 * above does — because sliding a panel vertically would put it over the text it
 * describes.
 */

/** Gap between the trigger and the panel, px. Matches the visual offset in CSS. */
const GAP = 7;

/** Minimum breathing room between the panel and the viewport edge, px. */
const EDGE = 12;

export type InfoTipProps = {
  /**
   * The explanation. One or two sentences; this is a tooltip, not a manual. If
   * it needs a list or a code block it is not tooltip content — it is either an
   * `AdminNotice` or it belongs in the repo's docs.
   */
  children: ReactNode;
  /**
   * The trigger's accessible name. Default "More information" is honest but
   * useless in a list of six of them, so name the subject: `About case studies`,
   * `About the ingest token scopes`. `AdminPageHeader` fills this in from the
   * page title.
   */
  label?: string;
  /** Extra class on the wrapper, for the rare caller that needs to nudge it. */
  className?: string;
};

export function InfoTip({ children, label, className }: InfoTipProps) {
  const panelId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  /**
   * Work out where the panel goes, from the trigger's box and the panel's own.
   *
   * Stable across renders (it reads refs and calls a setter, and closes over
   * nothing else), so the effect below can depend on it without re-subscribing
   * its listeners on every render.
   */
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;

    if (!trigger || !panel) {
      return;
    }

    const t = trigger.getBoundingClientRect();
    /* Real width and height: the panel is `visibility: hidden`, not
       `display: none`, so it is laid out. Only opacity and a 2px translate
       differ between the closed and open states, neither of which changes the
       box, so this measurement is valid for the state we are about to enter. */
    const p = panel.getBoundingClientRect();

    /* Inline: start-aligned with the trigger, then clamped. `Math.max` runs
       second on purpose — when the panel is wider than the viewport (a very
       narrow phone) the clamp upper bound goes negative, and EDGE is the less
       wrong answer of the two. */
    const left = Math.max(EDGE, Math.min(t.left, window.innerWidth - p.width - EDGE));

    /* Block: below unless below overflows and above does not. */
    const below = t.bottom + GAP;
    const above = t.top - p.height - GAP;
    const fitsBelow = below + p.height + EDGE <= window.innerHeight;
    const top = fitsBelow || above < EDGE ? below : above;

    setAt({ left, top });
  }, []);

  /**
   * Pending mouse-leave close. The panel sits 7px from the trigger, and although
   * it is a DOM child of the root (so hovering *it* does not leave the root),
   * crossing that gap does — and an instant close means the panel is gone before
   * the pointer arrives. WCAG 1.4.13 "Hoverable" requires the revealed content
   * itself to be hoverable, and several tips contain `<code>` snippets worth
   * selecting. So a mouse leave schedules the close and a re-enter cancels it;
   * 150ms is enough to cross 7px at any humane pointer speed while still feeling
   * immediate. Escape and tap-outside stay instant — they close via `setOpen`
   * directly and a stale timer firing afterwards just sets `false` to `false`.
   */
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  /* The timer must not outlive the component. */
  useEffect(() => cancelClose, [cancelClose]);

  const show = useCallback(() => {
    cancelClose();
    place();
    setOpen(true);
  }, [cancelClose, place]);

  /**
   * Everything that closes the panel, plus keeping it attached to its trigger
   * while it is open. All of it is scoped to the open state so a page with
   * fifteen InfoTips has zero listeners at rest.
   */
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        /* No `preventDefault`. Escape is overloaded — it may also be closing a
           native picker or reverting an input — and a tooltip has no business
           swallowing it. Closing is all this needs to do. */
        setOpen(false);
      }
    };

    /* Tap-outside on touch, click-outside on a mouse. `pointerdown` rather than
       `click` so it fires before focus moves, matching FooterThemePicker. */
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    /* A fixed panel does not travel with its trigger, so scrolling anything —
       the page, the sidebar, a table's overflow container — has to re-place it.
       `capture` is what catches the nested scrollers; `passive` keeps it off the
       scrolling critical path. */
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { capture: true, passive: true });

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, { capture: true });
    };
  }, [open, place]);

  const onPointerEnter = (event: ReactPointerEvent<HTMLSpanElement>) => {
    /* Mouse only — see the docblock on why touch must not open on enter. */
    if (event.pointerType === "mouse") {
      show();
    }
  };

  const onPointerLeave = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.pointerType === "mouse") {
      /* Deferred, not immediate — see `closeTimer`. */
      cancelClose();
      closeTimer.current = setTimeout(() => setOpen(false), 150);
    }
  };

  return (
    <span
      ref={rootRef}
      className={className ? `adm-tip ${className}` : "adm-tip"}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <button
        ref={triggerRef}
        type="button"
        className="adm-tip-trigger"
        /* Permanent. The description exists for a screen reader whether or not
           the panel is visible — see the docblock. */
        aria-describedby={panelId}
        aria-label={label ?? "More information"}
        data-open={open ? "true" : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onFocus={(event) => {
          /* Keyboard focus reveals it; a mouse or touch press does not, because
             a `<button>` only matches :focus-visible for keyboard focus. Without
             this test the reveal would race the click toggle below and a tap
             would never open anything. */
          if (event.currentTarget.matches(":focus-visible")) {
            show();
          }
        }}
        onBlur={() => setOpen(false)}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        >
          <circle cx="10" cy="10" r="7.3" />
          <path d="M10 9.1v4.3" />
          <circle cx="10" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      </button>

      <span
        ref={panelRef}
        id={panelId}
        role="tooltip"
        className="adm-tip-panel"
        data-open={open ? "true" : undefined}
        /* Left/top only. Width, colour and the hidden state are CSS's; the two
           numbers a stylesheet cannot know are JS's. `at` is null until the
           first open, when the panel is invisible anyway. */
        style={at ? { left: at.left, top: at.top } : undefined}
      >
        {children}
      </span>
    </span>
  );
}

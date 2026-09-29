"use client";

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { addFeedback, removeFeedback, reopenFeedback, updateFeedback } from "@/app/(site)/preview/actions";

/**
 * The preview's feedback layer (docs/plans/preview-area.md, decisions 7–10).
 *
 * Select text in the post, or hover (tap, on a phone) an image, and a bubble
 * offers ✅ ❓ 😠 and 💬. A reaction closes the bubble and sits on the passage
 * like a Messenger reaction; hovering it again offers "Add note". Notes are
 * plain text, so emoji work, with one-tap inserts.
 *
 * ── Anchoring ──────────────────────────────────────────────────────────────
 *
 * A text anchor is the quoted passage plus ~32 characters either side, taken
 * from the post's text with whitespace collapsed. To show it again, the quote
 * is searched for in the current text and the prefix/suffix pick the right
 * occurrence — so feedback survives re-renders and small edits, and an anchor
 * whose text is gone lands in "No longer in the draft" with its quote.
 * Highlights use the CSS Custom Highlight API, which marks text without
 * touching the server-rendered post HTML.
 */

export type Reaction = "love" | "unclear" | "dislike";
export type FeedbackItem = {
  id: string;
  anchor:
    | { kind: "text"; quote: string; prefix: string; suffix: string }
    | { kind: "image"; src: string; alt: string };
  reaction: Reaction | null;
  note: string | null;
  status: "open" | "resolved" | "archived";
  resolution: string | null;
};

const REACTIONS: { value: Reaction; emoji: string; label: string }[] = [
  { value: "love", emoji: "✅", label: "Love this — keep it" },
  { value: "unclear", emoji: "❓", label: "Unclear — reword or explain" },
  { value: "dislike", emoji: "😠", label: "Don't like it — rewrite or remove" },
];
const EMOJI_OF: Record<Reaction, string> = { love: "✅", unclear: "❓", dislike: "😠" };
const QUICK_EMOJI = ["✅", "❓", "😠", "👍", "🔥", "✂️", "🤔"];
const CONTEXT = 32;

/* ------------------------------------------------------------------ *
 * Text index: the prose's text, whitespace-collapsed, mapped back to DOM
 * ------------------------------------------------------------------ */

type TextIndex = {
  text: string;
  /** For each normalised character, its raw offset. */
  normToRaw: number[];
  /** For each raw offset (inclusive of end), the normalised offset. */
  rawToNorm: number[];
  nodes: { node: Text; start: number }[];
};

function buildIndex(root: Element): TextIndex {
  const nodes: { node: Text; start: number }[] = [];
  let raw = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node: node as Text, start: raw.length });
    raw += (node as Text).data;
  }
  let text = "";
  const normToRaw: number[] = [];
  const rawToNorm: number[] = new Array(raw.length + 1);
  let inSpace = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    rawToNorm[i] = text.length;
    if (/\s/.test(ch)) {
      if (!inSpace) { text += " "; normToRaw.push(i); }
      inSpace = true;
    } else {
      text += ch; normToRaw.push(i); inSpace = false;
    }
  }
  rawToNorm[raw.length] = text.length;
  return { text, normToRaw, rawToNorm, nodes };
}

function rawPoint(index: TextIndex, raw: number): { node: Text; offset: number } | null {
  let lo = 0;
  let hi = index.nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (index.nodes[mid]!.start <= raw) lo = mid; else hi = mid - 1;
  }
  const entry = index.nodes[lo];
  return entry ? { node: entry.node, offset: Math.min(raw - entry.start, entry.node.data.length) } : null;
}

function rangeFor(index: TextIndex, start: number, end: number): Range | null {
  if (end <= start) return null;
  const a = rawPoint(index, index.normToRaw[start]!);
  const b = rawPoint(index, index.normToRaw[end - 1]! + 1);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

function locateQuote(index: TextIndex, anchor: { quote: string; prefix: string; suffix: string }): Range | null {
  const quote = anchor.quote.replace(/\s+/g, " ").trim();
  if (!quote) return null;
  let best = -1;
  let bestScore = -1;
  for (let at = index.text.indexOf(quote); at !== -1; at = index.text.indexOf(quote, at + 1)) {
    const before = index.text.slice(Math.max(0, at - CONTEXT), at);
    const after = index.text.slice(at + quote.length, at + quote.length + CONTEXT);
    let score = 0;
    for (let i = 1; i <= Math.min(before.length, anchor.prefix.length); i += 1) {
      if (before[before.length - i] === anchor.prefix[anchor.prefix.length - i]) score += 1; else break;
    }
    for (let i = 0; i < Math.min(after.length, anchor.suffix.length); i += 1) {
      if (after[i] === anchor.suffix[i]) score += 1; else break;
    }
    if (score > bestScore) { best = at; bestScore = score; }
  }
  return best === -1 ? null : rangeFor(index, best, best + quote.length);
}

/** The selection as a text anchor, or null if it is empty or outside the prose. */
function anchorFromSelection(root: Element, selection: Selection): { quote: string; prefix: string; suffix: string; range: Range } | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const index = buildIndex(root);
  const measure = (node: Node, offset: number) => {
    const probe = document.createRange();
    probe.setStart(root, 0);
    probe.setEnd(node, offset);
    return probe.toString().length;
  };
  let start = index.rawToNorm[measure(range.startContainer, range.startOffset)] ?? 0;
  let end = index.rawToNorm[measure(range.endContainer, range.endOffset)] ?? start;
  while (start < end && index.text[start] === " ") start += 1;
  while (end > start && index.text[end - 1] === " ") end -= 1;
  const quote = index.text.slice(start, end);
  if (quote.length < 2) return null;
  return {
    quote: quote.slice(0, 600),
    prefix: index.text.slice(Math.max(0, start - CONTEXT), start),
    suffix: index.text.slice(end, end + CONTEXT),
    range: range.cloneRange(),
  };
}

/* ------------------------------------------------------------------ *
 * The layer
 * ------------------------------------------------------------------ */

type Box = { top: number; left: number; width: number; height: number };
type Located = { item: FeedbackItem; rects: Box[]; badge: Box };
type Draft =
  | { kind: "text"; anchor: { kind: "text"; quote: string; prefix: string; suffix: string }; at: Box }
  | { kind: "image"; anchor: { kind: "image"; src: string; alt: string }; at: Box };

function relativeBox(rect: DOMRect, container: DOMRect): Box {
  return { top: rect.top - container.top, left: rect.left - container.left, width: rect.width, height: rect.height };
}

/** The stored URL of an image: the original behind a next/image URL, or the src itself. */
function imageUrl(img: HTMLImageElement): string {
  try {
    const url = new URL(img.currentSrc || img.src, window.location.href);
    return url.pathname.startsWith("/_next/image") ? url.searchParams.get("url") ?? url.href : url.href;
  } catch {
    return img.src;
  }
}

export function FeedbackLayer({
  postId,
  items,
  children,
}: {
  postId: string;
  items: FeedbackItem[];
  children: ReactNode;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [located, setLocated] = useState<Located[]>([]);
  const [width, setWidth] = useState(0);
  const [missing, setMissing] = useState<FeedbackItem[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [noteFor, setNoteFor] = useState<"new" | string | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /** Closes an image bubble shortly after the pointer leaves the image, unless it moves onto the bubble. */
  const imageLeave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelImageLeave = () => { if (imageLeave.current) clearTimeout(imageLeave.current); imageLeave.current = null; };

  const active = useMemo(() => items.filter((item) => item.status !== "archived"), [items]);

  /* ---- place existing feedback --------------------------------------- */

  const layout = useCallback(() => {
    const container = containerRef.current;
    const prose = container?.querySelector(".blog-prose");
    if (!container) return;
    const box = container.getBoundingClientRect();
    const index = prose ? buildIndex(prose) : null;
    const ranges: Record<Reaction | "note", Range[]> = { love: [], unclear: [], dislike: [], note: [] };
    const placed: Located[] = [];
    const lost: FeedbackItem[] = [];

    for (const item of active) {
      if (item.anchor.kind === "text") {
        const range = index ? locateQuote(index, item.anchor) : null;
        const rects = range ? Array.from(range.getClientRects()).filter((r) => r.width > 0) : [];
        if (!range || rects.length === 0) { lost.push(item); continue; }
        if (item.status === "open") ranges[item.reaction ?? "note"].push(range);
        const last = rects[rects.length - 1]!;
        placed.push({
          item,
          rects: rects.map((r) => relativeBox(r, box)),
          badge: { top: last.top - box.top - 22, left: last.right - box.left - 10, width: 0, height: 0 },
        });
      } else {
        const src = item.anchor.src;
        const img = Array.from(container.querySelectorAll("img")).find((el) => imageUrl(el) === src);
        if (!img) { lost.push(item); continue; }
        const r = img.getBoundingClientRect();
        placed.push({
          item,
          rects: [relativeBox(r, box)],
          badge: { top: r.top - box.top + 10, left: r.right - box.left - 12, width: 0, height: 0 },
        });
      }
    }

    // Several items on the same passage or image would stack exactly; fan them
    // out side by side instead, like a row of reactions.
    const seen = new Map<string, number>();
    for (const entry of placed) {
      const key = `${Math.round(entry.badge.top / 8)}:${Math.round(entry.badge.left / 8)}`;
      const count = seen.get(key) ?? 0;
      seen.set(key, count + 1);
      entry.badge = { ...entry.badge, left: entry.badge.left + count * 30 };
    }

    if ("highlights" in CSS) {
      for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
        CSS.highlights.set(`pv-${key}`, new Highlight(...ranges[key]));
      }
    }
    setLocated(placed);
    setMissing(lost);
    setWidth(box.width);
  }, [active]);

  useLayoutEffect(() => {
    layout();
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => layout());
    observer.observe(container);
    const images = Array.from(container.querySelectorAll("img"));
    images.forEach((img) => img.addEventListener("load", layout));
    return () => {
      observer.disconnect();
      images.forEach((img) => img.removeEventListener("load", layout));
      if ("highlights" in CSS) for (const key of ["love", "unclear", "dislike", "note"]) CSS.highlights.delete(`pv-${key}`);
    };
  }, [layout]);

  /* ---- new feedback from a selection ---------------------------------- */

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const container = containerRef.current;
        const prose = container?.querySelector(".blog-prose");
        const selection = window.getSelection();
        if (!container || !prose || !selection) return;
        const anchor = anchorFromSelection(prose, selection);
        if (!anchor) {
          setDraft((current) => (current?.kind === "text" && noteFor !== "new" ? null : current));
          return;
        }
        const rects = anchor.range.getClientRects();
        const last = rects[rects.length - 1];
        if (!last) return;
        const box = container.getBoundingClientRect();
        setOpenItem(null);
        setNoteFor(null);
        setDraft({
          kind: "text",
          anchor: { kind: "text", quote: anchor.quote, prefix: anchor.prefix, suffix: anchor.suffix },
          at: { top: last.bottom - box.top + 8, left: Math.max(0, last.left - box.left), width: 0, height: 0 },
        });
      }, 250);
    };
    document.addEventListener("selectionchange", onChange);
    return () => { clearTimeout(timer); document.removeEventListener("selectionchange", onChange); };
  }, [noteFor]);

  /* ---- new feedback on an image --------------------------------------- */

  const offerImage = (img: HTMLImageElement) => {
    const container = containerRef.current;
    if (!container || window.getSelection()?.isCollapsed === false) return;
    const src = imageUrl(img);
    const existing = located.find((entry) => entry.item.anchor.kind === "image" && entry.item.anchor.src === src);
    if (existing) { setOpenItem(existing.item.id); setDraft(null); return; }
    const box = container.getBoundingClientRect();
    const r = img.getBoundingClientRect();
    setOpenItem(null);
    setDraft({
      kind: "image",
      anchor: { kind: "image", src, alt: img.alt },
      at: { top: r.top - box.top + 12, left: r.left - box.left + 12, width: 0, height: 0 },
    });
  };

  /* ---- hovering an existing highlight --------------------------------- */

  const hitTest = (clientX: number, clientY: number): Located | undefined => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return undefined;
    const x = clientX - box.left;
    const y = clientY - box.top;
    return located.find((entry) => entry.item.anchor.kind === "text"
      && entry.rects.some((r) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height));
  };

  /* ---- server calls ---------------------------------------------------- */

  const run = (call: () => Promise<{ ok: boolean; message: string } | null>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await call();
      if (result && !result.ok) { setError(result.message); return; }
      after?.();
      router.refresh();
    });
  };

  const react = (reaction: Reaction) => {
    if (!draft) return;
    const anchor = draft.anchor;
    run(() => addFeedback(postId, anchor, reaction, null), () => {
      setDraft(null);
      window.getSelection()?.removeAllRanges();
    });
  };

  const saveNote = (text: string) => {
    if (noteFor === "new" && draft) {
      const anchor = draft.anchor;
      run(() => addFeedback(postId, anchor, null, text), () => {
        setDraft(null); setNoteFor(null); window.getSelection()?.removeAllRanges();
      });
    } else if (noteFor) {
      const id = noteFor;
      run(() => updateFeedback(id, { note: text }), () => setNoteFor(null));
    }
  };

  const current = openItem ? located.find((entry) => entry.item.id === openItem) ?? null : null;

  return (
    <div
      ref={containerRef}
      className="pv-feedback"
      onMouseOver={(event) => {
        const target = event.target as HTMLElement;
        if (target instanceof HTMLImageElement && !noteFor && draft?.kind !== "text") {
          cancelImageLeave();
          offerImage(target);
        }
      }}
      onMouseOut={(event) => {
        const target = event.target as HTMLElement;
        if (!(target instanceof HTMLImageElement) || noteFor) return;
        cancelImageLeave();
        imageLeave.current = setTimeout(() => setDraft((d) => (d?.kind === "image" ? null : d)), 250);
      }}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest(".pv-bubble, .pv-badge, .pv-panel, .pv-panel-toggle")) return;
        if (target instanceof HTMLImageElement) { offerImage(target); return; }
        const hit = hitTest(event.clientX, event.clientY);
        if (hit && window.getSelection()?.isCollapsed !== false) { setOpenItem(hit.item.id); setDraft(null); }
        else if (!noteFor && window.getSelection()?.isCollapsed !== false) { setOpenItem(null); setDraft((d) => (d?.kind === "image" ? null : d)); }
      }}
    >
      {children}

      {/* Reactions sitting on their passages and images. */}
      {located.map(({ item, badge }) => (
        <button
          key={item.id}
          type="button"
          className={`pv-badge ${item.status === "resolved" ? "pv-badge-resolved" : ""}`}
          style={{ top: badge.top, left: badge.left }}
          onClick={() => { setOpenItem(item.id); setDraft(null); setNoteFor(null); }}
          onMouseEnter={() => {
            if (noteFor || draft?.kind === "text") return;
            cancelImageLeave();
            setDraft(null);
            setOpenItem(item.id);
          }}
          aria-label="Open feedback"
        >
          {item.reaction ? EMOJI_OF[item.reaction] : "💬"}
          {item.reaction && item.note ? <span className="pv-badge-dot" aria-hidden="true" /> : null}
        </button>
      ))}

      {/* New feedback: reactions, or a note. */}
      {draft ? (
        <div
          className="pv-bubble"
          style={{ top: draft.at.top, left: clampLeft(draft.at.left, width, noteFor === "new" ? 300 : 190) }}
          role="dialog"
          aria-label="Add feedback"
          onMouseEnter={cancelImageLeave}
          onMouseLeave={() => {
            if (draft.kind !== "image" || noteFor) return;
            imageLeave.current = setTimeout(() => setDraft((d) => (d?.kind === "image" ? null : d)), 250);
          }}
        >
          {noteFor === "new" ? (
            <NoteEditor initial="" onSave={saveNote} onCancel={() => setNoteFor(null)} pending={pending} />
          ) : (
            <div className="pv-bubble-row">
              {REACTIONS.map((r) => (
                <button key={r.value} type="button" className="pv-emoji" title={r.label} aria-label={r.label} onClick={() => react(r.value)} disabled={pending}>
                  {r.emoji}
                </button>
              ))}
              <button type="button" className="pv-emoji" title="Add a note" aria-label="Add a note" onClick={() => setNoteFor("new")}>💬</button>
            </div>
          )}
        </div>
      ) : null}

      {/* An existing item: change the reaction, add or edit the note, reopen, remove. */}
      {current ? (
        <div
          className="pv-bubble pv-bubble-item"
          style={{ top: current.badge.top + 30, left: clampLeft(current.badge.left - 220, width, 300) }}
          role="dialog"
          aria-label="Feedback"
          onMouseLeave={() => { if (!noteFor) setOpenItem(null); }}
        >
          <div className="pv-bubble-row">
            {REACTIONS.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`pv-emoji ${current.item.reaction === r.value ? "pv-emoji-on" : ""}`}
                title={r.label}
                aria-label={r.label}
                aria-pressed={current.item.reaction === r.value}
                disabled={pending}
                onClick={() => run(() => updateFeedback(current.item.id, { reaction: current.item.reaction === r.value ? null : r.value }))}
              >
                {r.emoji}
              </button>
            ))}
            <button type="button" className="pv-link" onClick={() => setNoteFor(current.item.id)}>
              {current.item.note ? "Edit note" : "Add note"}
            </button>
          </div>
          {noteFor === current.item.id ? (
            <NoteEditor initial={current.item.note ?? ""} onSave={saveNote} onCancel={() => setNoteFor(null)} pending={pending} />
          ) : current.item.note ? (
            <p className="pv-note">{current.item.note}</p>
          ) : null}
          {current.item.status === "resolved" ? (
            <div className="pv-resolution">
              <span className="hor-eyebrow">Resolved</span>
              <p>{current.item.resolution}</p>
              <button type="button" className="pv-link" onClick={() => run(() => reopenFeedback(current.item.id))}>Reopen</button>
            </div>
          ) : null}
          <button type="button" className="pv-link pv-link-danger" onClick={() => run(() => removeFeedback(current.item.id), () => setOpenItem(null))}>
            Remove
          </button>
        </div>
      ) : null}

      {error ? <p className="pv-error pv-float-error" role="alert">{error}</p> : null}

      {/* Everything at a glance. */}
      <button type="button" className="pv-panel-toggle hor-btn hor-btn-ghost" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen}>
        Feedback · {active.filter((i) => i.status === "open").length}
      </button>
      {panelOpen ? (
        <FeedbackPanel
          located={located}
          missing={missing}
          onJump={(id) => {
            const entry = located.find((e) => e.item.id === id);
            const box = containerRef.current?.getBoundingClientRect();
            if (entry && box) window.scrollTo({ top: window.scrollY + box.top + entry.badge.top - 160, behavior: "smooth" });
            setOpenItem(id);
          }}
          onReopen={(id) => run(() => reopenFeedback(id))}
          onRemove={(id) => run(() => removeFeedback(id))}
          onClose={() => setPanelOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** Keep a bubble of about `size` px inside the article's width. */
function clampLeft(left: number, width: number, size: number): number {
  return width > 0 ? Math.max(0, Math.min(left, width - size)) : Math.max(0, left);
}

function NoteEditor({ initial, onSave, onCancel, pending }: { initial: string; onSave: (text: string) => void; onCancel: () => void; pending: boolean }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const insert = (emoji: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? text.length;
    setText((value) => value.slice(0, at) + emoji + value.slice(at));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + emoji.length, at + emoji.length); });
  };
  return (
    <div className="pv-note-editor">
      <textarea
        ref={ref}
        value={text}
        maxLength={2000}
        rows={3}
        className="pv-input"
        placeholder="What should change?"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && text.trim()) onSave(text.trim());
          if (event.key === "Escape") onCancel();
        }}
      />
      <div className="pv-bubble-row">
        {QUICK_EMOJI.map((emoji) => (
          <button key={emoji} type="button" className="pv-emoji pv-emoji-sm" onClick={() => insert(emoji)} aria-label={`Insert ${emoji}`}>{emoji}</button>
        ))}
      </div>
      <div className="pv-bubble-row pv-bubble-end">
        <button type="button" className="pv-link" onClick={onCancel}>Cancel</button>
        <button type="button" className="hor-btn" disabled={pending || !text.trim()} onClick={() => onSave(text.trim())}>
          {pending ? "Saving…" : "Save note"}
        </button>
      </div>
    </div>
  );
}

function FeedbackPanel({
  located, missing, onJump, onReopen, onRemove, onClose,
}: {
  located: Located[];
  missing: FeedbackItem[];
  onJump: (id: string) => void;
  onReopen: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const open = located.filter((e) => e.item.status === "open").map((e) => e.item);
  const resolved = located.filter((e) => e.item.status === "resolved").map((e) => e.item);
  const label = (item: FeedbackItem) => item.anchor.kind === "text" ? `“${item.anchor.quote}”` : `Image: ${item.anchor.alt || "untitled"}`;
  const row = (item: FeedbackItem, jump: boolean) => (
    <li key={item.id} className="pv-panel-item">
      <button type="button" className="pv-panel-jump" onClick={() => jump && onJump(item.id)} disabled={!jump}>
        <span className="pv-panel-emoji">{item.reaction ? EMOJI_OF[item.reaction] : "💬"}</span>
        <span className="pv-panel-quote">{label(item)}</span>
      </button>
      {item.note ? <p className="pv-note">{item.note}</p> : null}
      {item.resolution ? <p className="pv-panel-resolution">↳ {item.resolution}</p> : null}
      <div className="pv-bubble-row">
        {item.status === "resolved" ? <button type="button" className="pv-link" onClick={() => onReopen(item.id)}>Reopen</button> : null}
        <button type="button" className="pv-link pv-link-danger" onClick={() => onRemove(item.id)}>Remove</button>
      </div>
    </li>
  );
  return (
    <aside className="pv-panel" aria-label="All feedback">
      <div className="pv-panel-head">
        <span className="hor-eyebrow">Feedback</span>
        <button type="button" className="pv-link" onClick={onClose}>Close</button>
      </div>
      <h3 className="pv-panel-heading">Open · {open.length}</h3>
      {open.length ? <ul>{open.map((item) => row(item, true))}</ul> : <p className="pv-panel-empty">Select text or hover an image to add feedback.</p>}
      {missing.length ? (
        <>
          <h3 className="pv-panel-heading">No longer in the draft · {missing.length}</h3>
          <ul>{missing.map((item) => row(item, false))}</ul>
        </>
      ) : null}
      {resolved.length ? (
        <details>
          <summary className="pv-panel-heading">Resolved · {resolved.length}</summary>
          <ul>{resolved.map((item) => row(item, true))}</ul>
        </details>
      ) : null}
    </aside>
  );
}

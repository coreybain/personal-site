"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * The published posts, as cards or as the one-line index, and the switch
 * between them.
 *
 * Both views are rendered on the server and passed in, so this island is only
 * the switch: it owns one piece of state and a `hidden` attribute. Cards are the
 * default because they are what a first visit wants; the index is for someone
 * scanning dates and titles. A hidden view is `display: none`, so its
 * `.hor-rise` entrance replays each time it is switched to.
 */

type View = "cards" | "index";

function GridGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="4.2" height="4.2" rx="1.1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="7.3" y="1.5" width="4.2" height="4.2" rx="1.1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.5" y="7.3" width="4.2" height="4.2" rx="1.1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="7.3" y="7.3" width="4.2" height="4.2" rx="1.1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function ListGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path
        d="M4.6 3h6.9M4.6 6.5h6.9M4.6 10h6.9M1.6 3h.6M1.6 6.5h.6M1.6 10h.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PostViews({ cards, index }: { cards: ReactNode; index: ReactNode }) {
  const [view, setView] = useState<View>("cards");
  const id = useId();

  const options: { value: View; label: string; glyph: ReactNode }[] = [
    { value: "cards", label: "Posts", glyph: <GridGlyph /> },
    { value: "index", label: "Index", glyph: <ListGlyph /> },
  ];

  return (
    <section className="pt-6 pb-16 sm:pt-8 sm:pb-20" aria-label="Posts">
      <div className="mb-6 flex justify-end sm:mb-7">
        <div className="blog-view-toggle" role="group" aria-label="View posts as" data-view={view}>
          <span className="blog-view-thumb" aria-hidden="true" />
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className="blog-view-option"
              aria-pressed={view === option.value}
              aria-controls={`${id}-${option.value}`}
              onClick={() => setView(option.value)}
            >
              {option.glyph}
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div id={`${id}-cards`} hidden={view !== "cards"}>
        {cards}
      </div>
      <div id={`${id}-index`} hidden={view !== "index"}>
        {index}
      </div>
    </section>
  );
}

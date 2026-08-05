"use client";

import { useState } from "react";

import type { Lab } from "@/lib/snapshot";

const GITHUB_FALLBACK_IMAGE = "/images/labs/github-repository.svg";

export function LabArtwork({ lab }: { lab: Lab }) {
  const [imageFailed, setImageFailed] = useState(false);
  const image = imageFailed ? GITHUB_FALLBACK_IMAGE : lab.coverImage?.url;

  if (!image) return null;

  return (
    // The Lab CMS accepts arbitrary image hosts. A native image avoids a
    // brittle allow-list, while the local fallback keeps rate limits from
    // leaving a broken remote image in the card.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image}
      alt={
        imageFailed
          ? `GitHub repository card for ${lab.repoFullName}`
          : (lab.coverImage?.alt ?? `Cover image for ${lab.title}`)
      }
      loading="lazy"
      onError={imageFailed ? undefined : () => setImageFailed(true)}
    />
  );
}

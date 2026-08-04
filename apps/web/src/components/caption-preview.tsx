"use client";

import { useEffect, useState } from "react";
import type { CaptionStyle } from "@fav/core";

const SAMPLE = ["Captions", "look", "like", "this"];

/**
 * Live caption style preview (FAV-703 AC: "preview in editor").
 *
 * Mirrors the word-highlighting rules in the Remotion Captions component, so
 * what the creator sees here is what gets burned into the render. Animating on
 * a timer stands in for playback position.
 */
export function CaptionPreview({ style }: { style: CaptionStyle }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (style === "none") return;
    const t = setInterval(() => setActive((i) => (i + 1) % SAMPLE.length), 550);
    return () => clearInterval(t);
  }, [style]);

  if (style === "none") {
    return (
      <div className="flex h-20 items-center justify-center rounded-lg border border-border-token bg-black/80 text-xs text-text-muted">
        No captions
      </div>
    );
  }

  return (
    <div className="flex h-20 items-center justify-center overflow-hidden rounded-lg border border-border-token bg-gradient-to-br from-[#1a1a2e] via-[#0f3460] to-[#e94560] px-3">
      <p
        className="text-center font-extrabold leading-tight"
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: style === "impact" ? "1.15rem" : "1rem",
          textShadow: "0 2px 12px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.8)"
        }}
      >
        {SAMPLE.map((word, i) => {
          const isActive = i === active;
          const spoken = i < active;
          let color = "#ffffff";
          const extra: React.CSSProperties = {};
          if (style === "karaoke") {
            color = spoken || isActive ? "#ffd400" : "#ffffff";
          } else if (style === "bold") {
            color = isActive ? "#7c5cff" : "#ffffff";
            if (isActive) {
              extra.textDecoration = "underline";
              extra.textDecorationThickness = "0.08em";
            }
          } else if (style === "impact") {
            color = isActive ? "#00e5a0" : "#ffffff";
            extra.textTransform = "uppercase";
            extra.display = "inline-block";
            if (isActive) extra.transform = "scale(1.12)";
          }
          return (
            <span key={word} style={{ color, marginRight: "0.28em", transition: "color 120ms", ...extra }}>
              {word}
            </span>
          );
        })}
      </p>
    </div>
  );
}

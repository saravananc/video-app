import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import type { CaptionCue, CaptionStyle } from "@fav/core";

/**
 * Burned-in, word-synced animated captions (FAV-804): the active cue is found by
 * time, each word lights up on its own timestamp, and the named styles map to the
 * caption presets (FAV-703). Text shadow + scrim keep it legible on any background.
 */
export const Captions: React.FC<{ cues: CaptionCue[]; style: CaptionStyle }> = ({ cues, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tSec = frame / fps;

  if (style === "none") return null;
  const cue = cues.find((c) => tSec >= c.startSec && tSec < c.endSec);
  if (!cue) return null;

  const pop = interpolate(tSec - cue.startSec, [0, 0.12], [0.85, 1], {
    extrapolateRight: "clamp"
  });

  const base: React.CSSProperties = {
    position: "absolute",
    left: "6%",
    right: "6%",
    bottom: "16%",
    textAlign: "center",
    fontFamily: "Arial, Helvetica, sans-serif",
    fontWeight: 800,
    lineHeight: 1.25,
    transform: `scale(${pop})`,
    textShadow: "0 2px 12px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.8)"
  };

  const fontSize = style === "impact" ? "3.4em" : "2.6em";

  return (
    <div style={{ ...base, fontSize }}>
      {cue.words.map((w, i) => {
        const active = tSec >= w.startSec && tSec < w.endSec;
        const spoken = tSec >= w.endSec;
        let color = "#ffffff";
        let extra: React.CSSProperties = {};
        if (style === "karaoke") {
          color = spoken || active ? "#ffd400" : "#ffffff";
        } else if (style === "bold") {
          color = active ? "#7c5cff" : "#ffffff";
          if (active) extra = { textDecoration: "underline", textDecorationThickness: "0.08em" };
        } else if (style === "impact") {
          color = active ? "#00e5a0" : "#ffffff";
          extra = {
            textTransform: "uppercase",
            display: active ? "inline-block" : "inline",
            transform: active ? "scale(1.12)" : undefined
          };
        }
        return (
          <span key={i} style={{ color, marginRight: "0.28em", ...extra }}>
            {w.word}
          </span>
        );
      })}
    </div>
  );
};

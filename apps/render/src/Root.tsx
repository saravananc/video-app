import React from "react";
import { Composition } from "remotion";
import { FavComposition } from "./FavComposition";
import { renderPropsSchema, type RenderProps } from "./props";

const DEFAULT_PROPS: RenderProps = renderPropsSchema.parse({
  scenes: [
    {
      imageUrl:
        "data:image/svg+xml;utf8," +
        encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="100%" height="100%" fill="#1a1a2e"/></svg>'),
      startSec: 0,
      endSec: 3
    }
  ],
  audioUrl: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=",
  cues: [],
  width: 1080,
  height: 1920,
  durationSeconds: 3
});

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="FavVideo"
      component={FavComposition}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={90}
      defaultProps={DEFAULT_PROPS}
      calculateMetadata={({ props }) => {
        const parsed = renderPropsSchema.parse(props);
        return {
          durationInFrames: Math.max(1, Math.ceil(parsed.durationSeconds * parsed.fps)),
          width: parsed.width,
          height: parsed.height,
          fps: parsed.fps,
          props: parsed
        };
      }}
    />
  );
};

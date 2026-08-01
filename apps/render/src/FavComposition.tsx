import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import { Captions } from "./Captions";
import type { RenderProps, RenderScene, SceneMotion } from "./props";

const TRANSITION_SEC = 0.5;

/** Ken Burns pan/zoom per scene (FAV-802), direction alternating by index. */
function motionFor(scene: RenderScene, index: number): SceneMotion {
  if (scene.motion) return scene.motion;
  return (["zoom-in", "pan-right", "zoom-out", "pan-left"] as const)[index % 4]!;
}

const SceneLayer: React.FC<{
  scene: RenderScene;
  index: number;
  transition: RenderProps["transition"];
}> = ({ scene, index, transition }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const durationFrames = Math.max(1, Math.round((scene.endSec - scene.startSec) * fps));
  const progress = Math.min(1, frame / durationFrames);

  const motion = motionFor(scene, index);
  let scale = 1;
  let translateX = 0;
  const translateY = 0;
  // Subtle motion, respecting aspect: max 8% zoom / 4% pan keeps edges covered (FAV-802 AC).
  switch (motion) {
    case "zoom-in":
      scale = 1.02 + progress * 0.08;
      break;
    case "zoom-out":
      scale = 1.1 - progress * 0.08;
      break;
    case "pan-left":
      scale = 1.08;
      translateX = progress * -4;
      break;
    case "pan-right":
      scale = 1.08;
      translateX = progress * 4;
      break;
  }

  // Transition treatments (FAV-803): fade cross-blends, slide pushes in, zoom punches in.
  let opacity = 1;
  let transitionTransform = "";
  const transFrames = TRANSITION_SEC * fps;
  if (transition === "fade") {
    opacity = interpolate(
      frame,
      [0, transFrames, durationFrames - transFrames, durationFrames],
      [index === 0 ? 1 : 0, 1, 1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
  } else if (transition === "slide") {
    const enter = interpolate(frame, [0, transFrames], [index === 0 ? 0 : 100, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp"
    });
    transitionTransform = `translateX(${enter}%)`;
    opacity = interpolate(frame, [durationFrames - transFrames, durationFrames], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp"
    });
  } else if (transition === "zoom") {
    const enterScale = interpolate(frame, [0, transFrames], [index === 0 ? 1 : 1.35, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp"
    });
    transitionTransform = `scale(${enterScale})`;
    opacity = interpolate(
      frame,
      [0, transFrames * 0.6, durationFrames - transFrames, durationFrames],
      [index === 0 ? 1 : 0, 1, 1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
  }

  const media = scene.clipUrl ? (
    <OffthreadVideo src={scene.clipUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
  ) : (
    <Img
      src={scene.imageUrl}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: `scale(${scale}) translate(${translateX}%, ${translateY}%)`
      }}
    />
  );

  return (
    <AbsoluteFill style={{ opacity, backgroundColor: "#000", transform: transitionTransform || undefined }}>
      {media}
      {scene.onScreenText ? (
        <div
          style={{
            position: "absolute",
            top: "8%",
            left: "6%",
            right: "6%",
            textAlign: "center",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontWeight: 900,
            fontSize: "3em",
            color: "#fff",
            textShadow: "0 2px 16px rgba(0,0,0,0.9)"
          }}
        >
          {scene.onScreenText}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Background music ducked under narration (FAV-805): volume dips while words play. */
const DuckedMusic: React.FC<{ musicUrl: string; cues: RenderProps["cues"] }> = ({ musicUrl, cues }) => {
  const { fps } = useVideoConfig();
  return (
    <Audio
      src={musicUrl}
      loop
      volume={(frame) => {
        const tSec = frame / fps;
        const narrating = cues.some((c) => tSec >= c.startSec - 0.1 && tSec < c.endSec + 0.1);
        return narrating ? 0.07 : 0.22;
      }}
    />
  );
};

/** The parameterized composition — props fully drive output (FAV-801). */
export const FavComposition: React.FC<RenderProps> = (props) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {props.scenes.map((scene, i) => {
        const from = Math.round(scene.startSec * fps);
        // Overlap by the transition so fades cross-blend (FAV-803).
        const overlap = props.transition === "none" ? 0 : Math.round(TRANSITION_SEC * fps);
        const duration = Math.max(1, Math.round((scene.endSec - scene.startSec) * fps) + overlap);
        return (
          <Sequence key={i} from={from} durationInFrames={duration}>
            <SceneLayer scene={scene} index={i} transition={props.transition} />
          </Sequence>
        );
      })}
      <Audio src={props.audioUrl} />
      {props.musicUrl ? <DuckedMusic musicUrl={props.musicUrl} cues={props.cues} /> : null}
      <Captions cues={props.cues} style={props.captionStyle} />
      {props.watermark ? (
        <div
          style={{
            position: "absolute",
            top: "2.5%",
            right: "3%",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: "1.1em",
            fontWeight: 700,
            color: "rgba(255,255,255,0.55)",
            textShadow: "0 1px 6px rgba(0,0,0,0.6)"
          }}
        >
          AI · FAV
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

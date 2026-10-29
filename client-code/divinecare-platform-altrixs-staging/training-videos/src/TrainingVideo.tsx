import React from "react";
import {
  AbsoluteFill,
  Series,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme } from "./theme";
import {
  RoleVideo,
  Scene,
  TITLE_FRAMES,
  SCENE_INTRO,
  STEP_FRAMES,
  OUTRO_FRAMES,
  sceneDuration,
} from "./data";

// ── Shared bits ────────────────────────────────────────────────────────────

const Wordmark: React.FC<{ size?: number }> = ({ size = 54 }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
    <span
      style={{
        fontSize: size,
        fontWeight: 800,
        letterSpacing: -1,
        color: theme.ink,
        fontFamily: theme.font,
      }}
    >
      Altrixs
    </span>
    <span
      style={{
        width: size * 0.16,
        height: size * 0.16,
        borderRadius: "50%",
        background: theme.teal,
        display: "inline-block",
        marginLeft: 4,
      }}
    />
  </div>
);

const ProgressBar: React.FC<{ progress: number }> = ({ progress }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: 10,
      background: "rgba(255,255,255,0.08)",
    }}
  >
    <div
      style={{
        width: `${Math.min(100, Math.max(0, progress * 100))}%`,
        height: "100%",
        background: `linear-gradient(90deg, ${theme.purpleDeep}, ${theme.purple}, ${theme.teal})`,
      }}
    />
  </div>
);

// ── Title ──────────────────────────────────────────────────────────────────

const TitleScene: React.FC<{ video: RoleVideo }> = ({ video }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drop = spring({ frame, fps, config: { damping: 200 } });
  const sub = spring({ frame: frame - 14, fps, config: { damping: 200 } });
  const tag = spring({ frame: frame - 26, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 700px at 30% 20%, #1E1B4B 0%, ${theme.bg} 60%)`,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: theme.font,
      }}
    >
      <div style={{ opacity: drop, transform: `translateY(${(1 - drop) * 40}px)` }}>
        <Wordmark size={64} />
      </div>
      <div
        style={{
          opacity: sub,
          transform: `translateY(${(1 - sub) * 40}px)`,
          fontSize: 96,
          fontWeight: 800,
          color: theme.ink,
          marginTop: 34,
          textAlign: "center",
          maxWidth: 1500,
          lineHeight: 1.05,
        }}
      >
        {video.role}
      </div>
      <div
        style={{
          opacity: tag,
          transform: `translateY(${(1 - tag) * 40}px)`,
          fontSize: 44,
          color: theme.muted,
          marginTop: 28,
          textAlign: "center",
          maxWidth: 1300,
        }}
      >
        {video.tagline}
      </div>
      <div
        style={{
          opacity: tag,
          marginTop: 44,
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: 4,
          textTransform: "uppercase",
          color: theme.teal,
        }}
      >
        Platform Training · Go-Live Nov 2
      </div>
      <div
        style={{
          opacity: tag,
          marginTop: 22,
          fontSize: 36,
          fontWeight: 800,
          color: theme.ink,
          background: "rgba(124,58,237,0.18)",
          border: `2px solid ${theme.purple}`,
          borderRadius: 999,
          padding: "12px 40px",
        }}
      >
        altrixs.com
      </div>
    </AbsoluteFill>
  );
};

// ── Step scene ─────────────────────────────────────────────────────────────

const StepRow: React.FC<{ index: number; text: string; appearAt: number }> = ({
  index,
  text,
  appearAt,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - appearAt, fps, config: { damping: 200 } });
  const active =
    frame >= appearAt && frame < appearAt + STEP_FRAMES ? 1 : 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 30,
        opacity: s,
        transform: `translateX(${(1 - s) * 60}px)`,
        background: active ? "rgba(124,58,237,0.14)" : "rgba(255,255,255,0.04)",
        border: `2px solid ${active ? theme.purple : "rgba(255,255,255,0.08)"}`,
        borderRadius: 18,
        padding: "26px 34px",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: active ? theme.purple : "rgba(124,58,237,0.25)",
          color: theme.ink,
          fontSize: 30,
          fontWeight: 800,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {index + 1}
      </div>
      <div style={{ fontSize: 40, color: theme.ink, lineHeight: 1.35, paddingTop: 4 }}>
        {text}
      </div>
    </div>
  );
};

const StepScene: React.FC<{
  scene: Scene;
  index: number;
  total: number;
}> = ({ scene, index, total }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const head = spring({ frame, fps, config: { damping: 200 } });
  const calloutAt = SCENE_INTRO + scene.steps.length * STEP_FRAMES;
  const calloutS = spring({ frame: frame - calloutAt, fps, config: { damping: 200 } });
  const dur = sceneDuration(scene);

  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        fontFamily: theme.font,
        padding: "90px 110px 110px",
      }}
    >
      {/* Header */}
      <div style={{ opacity: head, transform: `translateY(${(1 - head) * 30}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: 3,
              color: theme.teal,
              textTransform: "uppercase",
            }}
          >
            Scene {index + 1} / {total}
          </div>
          {scene.kicker ? (
            <div
              style={{
                fontSize: 26,
                fontWeight: 700,
                color: theme.gold,
                background: "rgba(212,160,23,0.12)",
                border: "1px solid rgba(212,160,23,0.4)",
                borderRadius: 999,
                padding: "6px 22px",
              }}
            >
              {scene.kicker}
            </div>
          ) : null}
        </div>
        <div
          style={{
            fontSize: 76,
            fontWeight: 800,
            color: theme.ink,
            marginTop: 14,
            lineHeight: 1.08,
          }}
        >
          {scene.title}
        </div>
      </div>

      {/* Steps */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 22,
          marginTop: 48,
          maxWidth: 1540,
        }}
      >
        {scene.steps.map((text, i) => (
          <StepRow
            key={i}
            index={i}
            text={text}
            appearAt={SCENE_INTRO + i * STEP_FRAMES}
          />
        ))}

        {scene.callout ? (
          <div
            style={{
              opacity: calloutS,
              transform: `translateY(${(1 - calloutS) * 40}px)`,
              marginTop: 10,
              background: "rgba(212,160,23,0.14)",
              border: `2px solid ${theme.gold}`,
              borderRadius: 18,
              padding: "26px 34px",
              fontSize: 40,
              fontWeight: 700,
              color: "#FBE4A8",
              lineHeight: 1.35,
            }}
          >
            {scene.callout}
          </div>
        ) : null}
      </div>

      <ProgressBar progress={interpolate(frame, [0, dur], [index / total, (index + 1) / total])} />
    </AbsoluteFill>
  );
};

// ── Outro ──────────────────────────────────────────────────────────────────

const OutroScene: React.FC<{ video: RoleVideo }> = ({ video }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame, fps, config: { damping: 200 } });
  const b = spring({ frame: frame - 18, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 700px at 70% 80%, #134E4A 0%, ${theme.bg} 60%)`,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: theme.font,
      }}
    >
      <div style={{ opacity: a, transform: `translateY(${(1 - a) * 40}px)` }}>
        <Wordmark size={54} />
      </div>
      <div
        style={{
          opacity: a,
          fontSize: 84,
          fontWeight: 800,
          color: theme.ink,
          marginTop: 30,
          textAlign: "center",
        }}
      >
        Now practice it.
      </div>
      <div
        style={{
          opacity: b,
          fontSize: 42,
          color: theme.muted,
          marginTop: 26,
          textAlign: "center",
          maxWidth: 1250,
          lineHeight: 1.45,
        }}
      >
        Everything you just watched runs in the demo sandbox — it never touches
        real charts. Complete your sign-off checklist with your site superuser.
      </div>
      <div
        style={{
          opacity: b,
          marginTop: 44,
          fontSize: 40,
          fontWeight: 800,
          color: theme.ink,
          border: `2px solid ${theme.purple}`,
          background: "rgba(124,58,237,0.18)",
          borderRadius: 999,
          padding: "14px 48px",
        }}
      >
        altrixs.com
      </div>
      <div
        style={{
          opacity: b,
          marginTop: 24,
          fontSize: 30,
          fontWeight: 700,
          color: theme.teal,
        }}
      >
        Questions → your superuser · Issues → the shared log
      </div>
    </AbsoluteFill>
  );
};

// ── Assembled video ────────────────────────────────────────────────────────

export const TrainingVideo: React.FC<{ video: RoleVideo }> = ({ video }) => {
  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <Series>
        <Series.Sequence durationInFrames={TITLE_FRAMES}>
          <TitleScene video={video} />
        </Series.Sequence>
        {video.scenes.map((scene, i) => (
          <Series.Sequence key={i} durationInFrames={sceneDuration(scene)}>
            <StepScene scene={scene} index={i} total={video.scenes.length} />
          </Series.Sequence>
        ))}
        <Series.Sequence durationInFrames={OUTRO_FRAMES}>
          <OutroScene video={video} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};

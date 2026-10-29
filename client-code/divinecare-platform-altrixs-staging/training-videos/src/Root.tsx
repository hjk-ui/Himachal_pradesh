import React from "react";
import { Composition } from "remotion";
import { TrainingVideo } from "./TrainingVideo";
import { VIDEOS, FPS, videoDuration } from "./data";

// One composition per role — ids: prescriber, therapist, front-desk, billing,
// medical-assistant, crisis-responder, director.
export const RemotionRoot: React.FC = () => {
  return (
    <>
      {VIDEOS.map((video) => (
        <Composition
          key={video.id}
          id={video.id}
          component={TrainingVideo}
          durationInFrames={videoDuration(video)}
          fps={FPS}
          width={1920}
          height={1080}
          defaultProps={{ video }}
        />
      ))}
    </>
  );
};

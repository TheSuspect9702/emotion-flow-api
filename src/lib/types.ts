// types.ts

export type ActorEmotion = {
  name?: string | null;
  emotion: string;
  confidence: number;
};

// One frame inside the "frames" array from Colab
export type FrameAnalysis = {
  frame_number: number;
  timestamp_ms: number;
  actors: ActorEmotion[];
  objects: string[];                          // Colab always sends []
  scene_score: number;                        // e.g. 0.0
  emotion_dominant: string | null;           // e.g. "amusement"
  emotion_distribution: Record<string, number>;
};

// Top-level payload from Colab
export type VideoFramesPayload = {
  video_id: string;          // "collab_test"
  frames: FrameAnalysis[];   // array of frames
};

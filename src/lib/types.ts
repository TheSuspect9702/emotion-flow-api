export type ActorEmotion = {
  name?: string | null;
  emotion: string;
  confidence: number;
};

export type FramePayload = {
  video_id: string;
  frame_number: number;
  timestamp_ms: number;
  actors: ActorEmotion[];
  objects?: string[];
  scene_score?: number;
  emotion_dominant?: string;
  emotion_distribution?: Record<string, number>;
};

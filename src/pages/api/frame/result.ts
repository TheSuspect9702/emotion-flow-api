import type { NextApiRequest, NextApiResponse } from 'next';
import { redis } from '../../../lib/redisClient';
import { supabaseAdmin } from '../../../lib/supabaseClient';

const REQUIRED_SECRET = process.env.INGESTION_API_KEY;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!REQUIRED_SECRET || token !== REQUIRED_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { video_id, frames } = req.body as {
      video_id: string;
      frames: Array<{
        frame_number: number;
        timestamp_ms: number;
        actors: any[];
        objects: string[];
        scene_score: number;
        emotion_dominant: string | null;
        emotion_distribution: Record<string, number>;
      }>;
    };

    if (!video_id || !Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({ error: 'Invalid input — expected video_id and frames[]' });
    }

    // -------------------------------------------------------------
    // 🚀 REDIS BULK PIPELINE — One network operation instead of N
    // -------------------------------------------------------------
    const pipeline = redis.pipeline();

    frames.forEach(frame => {
      const key = `video:${video_id}:frame:${frame.frame_number}`;
      pipeline.hmset(key, {
        video_id,
        frame_number: String(frame.frame_number),
        timestamp_ms: String(frame.timestamp_ms),
        actors: JSON.stringify(frame.actors),
        objects: JSON.stringify(frame.objects),
        scene_score: String(frame.scene_score ?? ''),
        emotion_dominant: frame.emotion_dominant ?? '',
        emotion_distribution: JSON.stringify(frame.emotion_distribution ?? {})
      });
    });

    await pipeline.exec();


    // -------------------------------------------------------------
    // 🚀 SINGLE BULK INSERT INTO SUPABASE
    // -------------------------------------------------------------
    const bulkInsertPayload = frames.map(frame => ({
      video_id,
      frame_number: frame.frame_number,
      timestamp_ms: frame.timestamp_ms,
      actors: frame.actors,
      objects: frame.objects,
      scene_score: frame.scene_score,
      emotion_dominant: frame.emotion_dominant,
      emotion_distribution: frame.emotion_distribution
    }));

    const { error } = await supabaseAdmin.from('frames').insert(bulkInsertPayload);

    if (error) {
      console.error('Supabase bulk insert error:', error);
      return res.status(500).json({ error: 'Supabase bulk insert failed' });
    }

    // ensure video exists once
    await supabaseAdmin.from('videos').upsert({ id: video_id }, { onConflict: 'id' });

    return res.status(200).json({
      status: 'ok',
      inserted_frames: frames.length,
      message: "Bulk ingest successful 🚀"
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

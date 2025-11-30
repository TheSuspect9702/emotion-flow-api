import type { NextApiRequest, NextApiResponse } from 'next';
import { redis } from '../../../lib/redisClient';
import { supabaseAdmin } from '../../../lib/supabaseClient';
import type { FramePayload } from '../../../lib/types';

const REQUIRED_SECRET = process.env.INGESTION_API_KEY;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');

  if (!REQUIRED_SECRET || token !== REQUIRED_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body as FramePayload;

    if (!body.video_id || typeof body.frame_number !== 'number') {
      return res.status(400).json({ error: 'Missing video_id or frame_number' });
    }

    const frameKey = `video:${body.video_id}:frame:${body.frame_number}`;

    await redis.hmset(frameKey, {
      video_id: body.video_id,
      frame_number: body.frame_number.toString(),
      timestamp_ms: body.timestamp_ms.toString(),
      actors: JSON.stringify(body.actors ?? []),
      objects: JSON.stringify(body.objects ?? []),
      scene_score: body.scene_score?.toString() ?? '',
      emotion_dominant: body.emotion_dominant ?? '',
      emotion_distribution: JSON.stringify(body.emotion_distribution ?? {})
    });

    const { error: insertError } = await supabaseAdmin.from('frames').insert({
      video_id: body.video_id,
      frame_number: body.frame_number,
      timestamp_ms: body.timestamp_ms,
      actors: body.actors ?? [],
      objects: body.objects ?? [],
      scene_score: body.scene_score ?? null,
      emotion_dominant: body.emotion_dominant ?? null,
      emotion_distribution: body.emotion_distribution ?? {}
    });

    if (insertError) {
      console.error('Supabase insert error:', insertError);
      return res.status(500).json({ error: 'Failed to insert into Supabase' });
    }

    await supabaseAdmin
      .from('videos')
      .upsert({ id: body.video_id }, { onConflict: 'id' });

    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Error in /api/frame/result', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

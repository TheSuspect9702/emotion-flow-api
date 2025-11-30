import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../../lib/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { videoId } = req.query;

  if (typeof videoId !== 'string') {
    return res.status(400).json({ error: 'Invalid videoId' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const limit = parseInt((req.query.limit as string) || '1000', 10);
    const from = 0;
    const to = limit - 1;

    const { data, error } = await supabaseAdmin
      .from('frames')
      .select('*')
      .eq('video_id', videoId)
      .order('frame_number', { ascending: true })
      .range(from, to);

    if (error) {
      console.error('Supabase select error:', error);
      return res.status(500).json({ error: 'Failed to fetch frames' });
    }

    return res.status(200).json({ video_id: videoId, frames: data });
  } catch (err) {
    console.error('Error in /api/video/[videoId]/frames', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

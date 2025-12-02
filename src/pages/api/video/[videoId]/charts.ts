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
    // 1. Pobieranie klatek
    const { data: framesData, error: framesError } = await supabaseAdmin
      .from('frames')
      .select('frame_number, timestamp_ms, emotion_distribution')
      .eq('video_id', videoId)
      .order('frame_number', { ascending: true });

    if (framesError) {
      console.error('Supabase frames error:', framesError);
      return res.status(500).json({ error: 'Failed to fetch frames' });
    }

    // 2. Pobieranie tytułu filmu
    const { data: videoData, error: videoError } = await supabaseAdmin
      .from('videos')
      .select('title')
      .eq('id', videoId)
      .single();

    if (videoError) {
      console.warn('Supabase video title error:', videoError);
    }

    // Przygotowanie struktur danych
    const areaData: any[] = [];
    const radarTotals: Record<string, number> = {};
    const movieTitle = videoData?.title || '';

    // 3. Przetwarzanie danych
    if (framesData) {
      framesData.forEach((row) => {
        // Rzutujemy dane z jsonb na obiekt
        const rawEmotions = (row.emotion_distribution || {}) as Record<string, number>;
        
        // Obiekt na przeliczone procenty dla tej konkretnej klatki
        const percentageEmotions: Record<string, number> = {};

        // Iterujemy po każdej emocji w danej klatce, aby zamienić ją na %
        Object.entries(rawEmotions).forEach(([key, value]) => {
          if (typeof value === 'number') {
            // KONWERSJA: mnożymy przez 100 i zaokrąglamy do liczby całkowitej
            const percentValue = Math.round(value * 100);

            // Zapisujemy do obiektu klatki (dla Area Chart)
            percentageEmotions[key] = percentValue;

            // Dodajemy do sumy całkowitej (dla Radar Chart)
            if (!radarTotals[key]) {
              radarTotals[key] = 0;
            }
            radarTotals[key] += percentValue;
          }
        });

        // Dodajemy przetworzoną klatkę do tablicy wynikowej
        areaData.push({
          frame: row.frame_number,
          timestamp: row.timestamp_ms,
          ...percentageEmotions, // Tu trafiają już wartości np. 86, 12, 5...
        });
      });
    }

    // 4. Zwracamy odpowiedź
    return res.status(200).json({
      area: areaData,
      radar: radarTotals,
      movieTitle: movieTitle
    });

  } catch (err) {
    console.error('Error in /api/video/[videoId]/analytics', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
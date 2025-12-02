// pages/api/movies.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabaseClient'; // Upewnij się, że ścieżka do klienta jest poprawna

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1. Sprawdzamy metodę HTTP - obsługujemy tylko GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    // 2. Pobieramy dane z Supabase
    // Wybieramy tylko kolumny 'id' oraz 'title' z tabeli 'videos'
    // .order() sortuje wyniki, np. od najnowszych (created_at malejąco)
    const { data, error } = await supabaseAdmin
      .from('videos')
      .select('id, title')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching movies:', error);
      throw error;
    }

    // 3. Zwracamy dane jako JSON
    // Format będzie: [{ id: "...", title: "..." }, { ... }]
    return res.status(200).json(data);

  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
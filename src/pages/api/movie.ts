import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm, File as FormidableFile } from 'formidable'; // Używamy aliasu dla jasności
import fs from 'fs';
import FormData from 'form-data';
import axios from 'axios';
import { supabaseAdmin } from '../../lib/supabaseClient';
import { randomUUID } from 'crypto';

// 1. Konfiguracja parsera
export const config = {
  api: {
    bodyParser: false,
  },
};

// Pomocnicza funkcja do parsowania formularza
const parseForm = async (req: NextApiRequest): Promise<{ fields: any; files: any }> => {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm();
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      resolve({ fields, files });
    });
  });
};

// Pomocnicza funkcja do "escape'owania" znaków specjalnych w nazwie pliku dla Regex
function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 2. Odbieramy plik
    const { files } = await parseForm(req);
    const uploadedFile = Array.isArray(files.file) ? files.file[0] : (files.file as FormidableFile);

    if (!uploadedFile) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const videoId = randomUUID();
    let originalTitle = uploadedFile.originalFilename || 'untitled_video';
    
    // --- POCZĄTEK LOGIKI WERSJONOWANIA (v_X) ---
    
    // Rozdzielamy nazwę i rozszerzenie
    const lastDotIndex = originalTitle.lastIndexOf('.');
    const baseName = lastDotIndex !== -1 ? originalTitle.substring(0, lastDotIndex) : originalTitle;
    const extension = lastDotIndex !== -1 ? originalTitle.substring(lastDotIndex) : '';

    // Pobieramy z bazy filmy, które mają podobną nazwę (zaczynają się tak samo)
    // Używamy .ilike, aby dopasować "nazwa%"
    const { data: existingFiles, error: searchError } = await supabaseAdmin
      .from('videos')
      .select('title')
      .ilike('title', `${baseName}%`);

    if (searchError) {
      console.error('Error checking existing files:', searchError);
      // Możemy kontynuować, ryzykując duplikat, lub rzucić błąd. Tutaj kontynuujemy.
    }

    let finalTitle = originalTitle;

    if (existingFiles && existingFiles.length > 0) {
      // Tworzymy Regex, który pasuje do: "nazwa.mp4" ORAZ "nazwa_v2.mp4", "nazwa_v15.mp4"
      // Grupa (\\d+) wyłapie numer wersji.
      const versionRegex = new RegExp(
        `^${escapeRegExp(baseName)}(_v(\\d+))?${escapeRegExp(extension)}$`, 
        'i'
      );

      let maxVersion = 0;
      let foundMatch = false;

      existingFiles.forEach((row) => {
        const match = row.title.match(versionRegex);
        if (match) {
          foundMatch = true;
          // match[2] to numer po "_v". Jeśli undefined, to znaczy, że to plik oryginalny (wersja 1)
          const version = match[2] ? parseInt(match[2], 10) : 1;
          if (version > maxVersion) {
            maxVersion = version;
          }
        }
      });

      // Jeśli znaleźliśmy jakikolwiek pasujący plik, zwiększamy wersję
      if (foundMatch) {
        finalTitle = `${baseName}_v${maxVersion + 1}${extension}`;
      }
    }
    
    // --- KONIEC LOGIKI WERSJONOWANIA ---

    // 3. Zapisujemy rekord w Supabase z nową nazwą (finalTitle)
    const { error: dbError } = await supabaseAdmin.from('videos').insert({
      id: videoId,
      title: finalTitle, // <-- Używamy nowej, unikalnej nazwy
    });

    if (dbError) {
      console.error('Supabase insert error:', dbError);
      return res.status(500).json({ error: 'Database insertion failed' });
    }

    // 4. Wysyłamy do Colab
    const formData = new FormData();
    formData.append('file', fs.createReadStream(uploadedFile.filepath));
    formData.append('video_id', videoId);
    
    // (Opcjonalnie) Możesz też wysłać finalTitle do Colaba, jeśli Colab tego potrzebuje
    // formData.append('video_title', finalTitle); 

    const colabResponse = await axios.post(
      'https://fumigatory-genesis-semipronely.ngrok-free.dev/process',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
        },
        maxBodyLength: Infinity,
      }
    );

    return res.status(200).json({
      status: 'ok',
      video_id: videoId,
      final_title: finalTitle, // Zwracamy frontendowi nową nazwę
    });

  } catch (err: any) {
    console.error('Upload handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
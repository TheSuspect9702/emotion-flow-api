import type { NextApiRequest, NextApiResponse } from 'next';
import FormData from 'form-data';
import axios from 'axios';
import { supabaseAdmin } from '../../lib/supabaseClient';
import { randomUUID } from 'crypto';

// NOTE: The 'config' export with bodyParser: false has been removed.
// Next.js will now automatically parse the JSON body containing the filePath.

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // --- Manual CORS Handling for this route ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Date, X-Api-Version');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  // ------------------------------------------

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Receive metadata from client (Client has already uploaded the file to Supabase Storage)
    const { filePath, originalFilename } = req.body;

    if (!filePath || !originalFilename) {
      return res.status(400).json({ error: 'Missing filePath or originalFilename in request body' });
    }

    const videoId = randomUUID();
    let originalTitle = originalFilename || 'untitled_video';
    
    // --- Versioning Logic ---
    const lastDotIndex = originalTitle.lastIndexOf('.');
    const baseName = lastDotIndex !== -1 ? originalTitle.substring(0, lastDotIndex) : originalTitle;
    const extension = lastDotIndex !== -1 ? originalTitle.substring(lastDotIndex) : '';

    const { data: existingFiles, error: searchError } = await supabaseAdmin
      .from('videos')
      .select('title')
      .ilike('title', `${baseName}%`);

    if (searchError) {
      console.error('Error checking existing files:', searchError);
    }

    let finalTitle = originalTitle;

    if (existingFiles && existingFiles.length > 0) {
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
          const version = match[2] ? parseInt(match[2], 10) : 1;
          if (version > maxVersion) {
            maxVersion = version;
          }
        }
      });

      if (foundMatch) {
        finalTitle = `${baseName}_v${maxVersion + 1}${extension}`;
      }
    }
    
    // --- Supabase Insert (Database Record) ---
    const { error: dbError } = await supabaseAdmin.from('videos').insert({
      id: videoId,
      title: finalTitle,
    });

    if (dbError) {
      console.error('Supabase insert error:', dbError);
      return res.status(500).json({ error: 'Database insertion failed' });
    }

    // --- Retrieve File from Supabase Storage ---
    const { data: fileBlob, error: downloadError } = await supabaseAdmin
      .storage
      .from('videos') 
      .download(filePath);

    if (downloadError) {
      console.error('Supabase storage download error:', downloadError);
      return res.status(500).json({ error: 'Failed to retrieve file from storage' });
    }

    // Convert the blob to a Buffer to send via FormData
    const arrayBuffer = await fileBlob.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // --- Colab Forwarding ---
    const formData = new FormData();
    formData.append('file', fileBuffer, finalTitle); // Send with the final versioned name
    formData.append('video_id', videoId);
    
    const colabResponse = await axios.post(
      'https://fumigatory-genesis-semipronely.ngrok-free.dev/process',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
        },
        maxBodyLength: Infinity, // Allow large payloads in Axios
      }
    );

    return res.status(200).json({
      status: 'ok',
      video_id: videoId,
      final_title: finalTitle,
    });

  } catch (err: any) {
    console.error('Upload handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
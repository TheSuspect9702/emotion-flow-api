import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm, File as FormidableFile } from 'formidable';
import fs from 'fs';
import FormData from 'form-data';
import axios from 'axios';
import { supabaseAdmin } from '../../lib/supabaseClient';
import { randomUUID } from 'crypto';

export const config = {
  api: {
    bodyParser: false,
  },
};

const parseForm = async (req: NextApiRequest): Promise<{ fields: any; files: any }> => {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm();
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      resolve({ fields, files });
    });
  });
};

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
    const { files } = await parseForm(req);
    const uploadedFile = Array.isArray(files.file) ? files.file[0] : (files.file as FormidableFile);

    if (!uploadedFile) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const videoId = randomUUID();
    let originalTitle = uploadedFile.originalFilename || 'untitled_video';
    
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
    
    // --- Supabase Insert ---
    const { error: dbError } = await supabaseAdmin.from('videos').insert({
      id: videoId,
      title: finalTitle,
    });

    if (dbError) {
      console.error('Supabase insert error:', dbError);
      return res.status(500).json({ error: 'Database insertion failed' });
    }

    // --- Colab Forwarding ---
    const formData = new FormData();
    formData.append('file', fs.createReadStream(uploadedFile.filepath));
    formData.append('video_id', videoId);
    
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
      final_title: finalTitle,
    });

  } catch (err: any) {
    console.error('Upload handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
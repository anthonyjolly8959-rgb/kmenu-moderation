const express = require('express');
const multer = require('multer');
const vision = require('@google-cloud/vision');

const app = express();
const upload = multer({
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB max
});
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'TA_CLE_SECRETE_ICI';

function createVisionClient() {
  // Preferred for cloud deploys (Render): set GOOGLE_CREDENTIALS_JSON
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const parsed = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    return new vision.ImageAnnotatorClient({
      credentials: {
        client_email: parsed.client_email,
        private_key: parsed.private_key
      },
      projectId: parsed.project_id
    });
  }

  // Local dev fallback
  return new vision.ImageAnnotatorClient({
    keyFilename: './google-vision-key.json'
  });
}

const client = createVisionClient();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/moderate-image', upload.single('image'), async (req, res) => {
  try {
    const clientSecret = req.headers['x-client-secret'];
    if (clientSecret !== CLIENT_SECRET) {
      return res.status(403).json({ error: 'unauthorized' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'no_image' });
    }

    const [result] = await client.safeSearchDetection(req.file.buffer);
    const safe = result?.safeSearchAnnotation || null;

    // Strict moderation: missing SafeSearch payload is treated as blocked.
    if (!safe) {
      return res.json({
        decision: 'BLOCK',
        scores: null,
        reason: 'safe_search_unavailable'
      });
    }

    const adultLevels = ['POSSIBLE', 'LIKELY', 'VERY_LIKELY'];
    const racyLevels = ['LIKELY', 'VERY_LIKELY'];

    const blocked =
      adultLevels.includes(safe.adult) ||
      racyLevels.includes(safe.racy);

    return res.json({
      decision: blocked ? 'BLOCK' : 'ALLOW',
      scores: safe
    });

  } catch (err) {
    console.error('Vision error:', err?.message || err);
    if (err?.stack) console.error(err.stack);
    if (err?.code) console.error('Vision error code:', err.code);
    if (err?.details) console.error('Vision error details:', err.details);

    // Strict moderation: if backend scan fails, block.
    return res.status(500).json({
      decision: 'BLOCK',
      error: 'vision_error',
      reason: 'scan_error'
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Moderation server running on port ${PORT}`);
});

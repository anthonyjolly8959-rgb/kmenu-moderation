const express = require('express');
const cors = require('cors');
const multer = require('multer');
const vision = require('@google-cloud/vision');

const app = express();
const allowedOrigins = new Set([
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
  'http://localhost:8004',
  'http://localhost:5173'
]);
app.use(cors({
  origin: (origin, cb) => {
    // Allow non-browser clients (curl/server-to-server)
    if (!origin) return cb(null, true);
    // Allow localhost dev ports and capacitor origins
    if (allowedOrigins.has(origin) || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    return cb(new Error('cors_not_allowed'));
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-client-secret']
}));
const upload = multer({
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB max
});
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'TA_CLE_SECRETE_ICI';
const client = new vision.ImageAnnotatorClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || '/etc/secrets/google-vision-key.json'
});

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
    console.log("VISION RAW RESULT:", JSON.stringify(result, null, 2));
    const safe = result?.safeSearchAnnotation || null;

    // Strict moderation: missing SafeSearch payload is treated as blocked.
    if (!safe) {
      console.log("SAFE IS NULL");
      return res.json({
        decision: 'BLOCK',
        scores: null,
        reason: 'safe_search_unavailable'
      });
    }

    const map = {
      UNKNOWN: 0,
      VERY_UNLIKELY: 1,
      UNLIKELY: 2,
      POSSIBLE: 3,
      LIKELY: 4,
      VERY_LIKELY: 5
    };
    const threshold = 4; // block only if LIKELY or above
    console.log("THRESHOLD:", threshold);
    console.log("SAFE OBJECT:", safe);
    console.log("ADULT VALUE:", safe.adult, "=>", map[safe.adult]);
    console.log("RACY VALUE:", safe.racy, "=>", map[safe.racy]);
    console.log("VIOLENCE VALUE:", safe.violence, "=>", map[safe.violence]);

    const blocked =
      (map[safe.adult] || 0) >= threshold ||
      (map[safe.racy] || 0) >= threshold ||
      (map[safe.violence] || 0) >= threshold;

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

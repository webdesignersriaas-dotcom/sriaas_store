import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 4000;

// Validate required env
const requiredEnv = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'S3_BUCKET'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required env: ${key}`);
    process.exit(1);
  }
}

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET;
const PROFILE_PREFIX = process.env.S3_PROFILE_PREFIX || 'profile-pics';

// Multer: memory storage (we send buffer to S3)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    // Allow by MIME type
    const allowedMime = /^image\/(jpeg|jpg|pjpeg|png|gif|webp)$/i;
    if (allowedMime.test(file.mimetype)) {
      return cb(null, true);
    }
    // When client doesn't send Content-Type (e.g. Flutter), allow by file extension
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    const allowedExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    if (allowedExt.includes(ext)) {
      return cb(null, true);
    }
    cb(new Error('Only images (.jpeg, .jpg, .png, .gif, .webp) are allowed.'), false);
  },
});

app.use(cors({ origin: true }));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'profile-pic-api' });
});

// Upload profile picture
// POST /api/upload/profile-pic
// Body: multipart/form-data with field "file" (image) and required "userId" (Shopify customer ID)
app.post('/api/upload/profile-pic', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Use field name "file".' });
    }

    const rawUserId = req.query?.userId || req.query?.user_id || req.body?.userId || req.body?.user_id;
    if (!rawUserId) {
      return res.status(400).json({ error: 'Missing userId (Shopify customer ID).' });
    }
    // Shopify customer IDs look like: gid://shopify/Customer/123
    // Use a stable S3 key by sanitizing slashes => "gid:--shopify-Customer-123"
    const userId = rawUserId.toString().replace(/\//g, '-');
    console.log(`[Profile Pic] Uploading... Shopify customer ID: ${rawUserId}`);

    const key = `${PROFILE_PREFIX}/${userId}`;
    const ext = (path.extname(req.file.originalname) || '').toLowerCase();
    // Use mimetype if it's a real image type, else infer from extension (e.g. when client sent application/octet-stream)
    const mime = req.file.mimetype && /^image\//.test(req.file.mimetype)
      ? req.file.mimetype
      : (ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg');

    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: mime,
        // Always re-fetch the latest image (avoid stale caches when user overwrites profile pic).
        CacheControl: 'no-store, max-age=0',
      })
    );

    // Public URL if bucket is public, otherwise presigned (optional)
    const baseUrl = process.env.S3_PUBLIC_BASE_URL;
    let url;
    if (baseUrl) {
      url = baseUrl.replace(/\/$/, '') + '/' + key;
    } else {
      url = await getSignedUrl(
        s3Client,
        new GetObjectCommand({ Bucket: BUCKET, Key: key }),
        { expiresIn: 60 * 60 * 24 * 6 } // max 6 days (AWS sig v4 must be < 7 days)
      );
    }

    console.log(`[Profile Pic] Upload success. Shopify customer ID: ${rawUserId}, key: ${key}`);
    console.log(`[Profile Pic] Image URL: ${url}`);
    res.status(201).json({
      success: true,
      url,
      key,
    });
  } catch (err) {
    console.error('[Profile Pic] Upload failed. Shopify customer ID:', req.query?.userId || req.query?.user_id || req.body?.userId || req.body?.user_id, err.message);
    res.status(500).json({
      error: err.message || 'Upload failed',
    });
  }
});

// List profile pictures in S3 (for verification in Postman etc.)
// GET /api/profile-pics
app.get('/api/profile-pics', async (req, res) => {
  try {
    const list = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: PROFILE_PREFIX + '/',
        MaxKeys: 100,
      })
    );
    const baseUrl = (process.env.S3_PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const items = (list.Contents || []).map((o) => {
      const key = o.Key;
      const url = baseUrl ? `${baseUrl}/${key}` : null;
      return { key, size: o.Size, lastModified: o.LastModified, url };
    });
    res.json({ prefix: PROFILE_PREFIX, count: items.length, items });
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ error: err.message || 'Failed to list' });
  }
});

// Get profile picture URL by key (optional)
// GET /api/profile-pic/:key
app.get('/api/profile-pic/:key(*)', async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 3600 }
    );
    res.json({ url });
  } catch (err) {
    console.error('Get URL error:', err);
    res.status(500).json({ error: err.message || 'Failed to get URL' });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Max 5 MB.' });
    }
  }
  if (err.message && err.message.includes('Only images')) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Profile pic API running on http://localhost:${PORT}`);
});

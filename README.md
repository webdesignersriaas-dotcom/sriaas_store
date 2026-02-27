# Profile Picture API (S3)

Node.js backend for storing user profile pictures in an **AWS S3** bucket. Use this from your Flutter app (or any client) to upload a profile image and get back a URL to save (e.g. in customer metafields or `avatar` field).

## Setup

### 1. AWS S3

- Create an S3 bucket (e.g. `sriaas-profile-pics`).
- Create an IAM user (or use existing) with a policy that allows:
  - `s3:PutObject`, `s3:GetObject` on that bucket (and optionally `s3:DeleteObject`).
- Note: **Access Key ID** and **Secret Access Key** for that user.

Optional: to return stable public URLs instead of presigned URLs, either:

- Enable **public read** on the bucket and set `S3_PUBLIC_BASE_URL` to your bucket URL, or  
- Put a **CloudFront** distribution in front of the bucket and set `S3_PUBLIC_BASE_URL` to the CloudFront URL.

### 2. Install and run

```bash
cd backend
# Edit .env with your AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET
npm install
npm start
```

Dev with auto-reload:

```bash
npm run dev
```

Server runs at `http://localhost:4000` (or the `PORT` in `.env`).

## API

### Health check

- **GET** `/health`  
- Response: `{ "ok": true, "service": "profile-pic-api" }`

### Upload profile picture

- **POST** `/api/upload/profile-pic`
- **Content-Type:** `multipart/form-data`
- **Body:**
  - `file` (required): image file (jpeg, png, gif, webp; max 5 MB)
  - `userId` or `user_id` (optional): identifier for the user (used in S3 key). If omitted, a random UUID is used.

**Example (curl):**

```bash
curl -X POST http://localhost:4000/api/upload/profile-pic \
  -F "file=@/path/to/photo.jpg" \
  -F "userId=customer-123"
```

**Success (201):**

```json
{
  "success": true,
  "url": "https://your-bucket.s3.amazonaws.com/profile-pics/customer-123.jpg",
  "key": "profile-pics/customer-123.jpg"
}
```

Use the `url` in your app (e.g. set as `avatar` in customer data so the profile screen shows it).

### Get profile picture URL by key

- **GET** `/api/profile-pic/:key`  
- Returns a presigned URL for the given S3 key (e.g. `profile-pics/customer-123.jpg`).

**Example:** `GET /api/profile-pic/profile-pics/customer-123.jpg`  
Response: `{ "url": "https://...presigned..." }`

## Flutter integration

1. Point your app to this API base URL (e.g. `https://your-server.com`).
2. After the user picks an image, send a **multipart** POST to `/api/upload/profile-pic` with:
   - field name `file` = image file
   - optional `userId` = Shopify customer ID or your user ID.
3. Use the returned `url` as the profile picture URL (e.g. store in customer metafields or `avatar` so existing logic like `_customerData?['avatar']` displays it).

## Security

- Do **not** commit `.env` (it’s in `.gitignore`). Use env vars or a secrets manager in production.
- In production, add auth (e.g. API key, JWT, or Supabase auth) so only logged-in users can upload.
- Restrict CORS in production to your app’s origins if needed.

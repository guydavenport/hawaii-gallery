# Hawaii Gallery

A private gallery app for photos and videos from a Hawaii trip.

## Stack
- Next.js
- Media storage: S3 (private bucket, presigned URLs)
- AWS-friendly architecture: Amplify, Cognito, DynamoDB, Lambda
- Local demo auth for now; metadata stored in `data/media.json` for now

## Run locally

Requires AWS credentials for the account/bucket below (an SSO profile works fine).

```bash
npm install
cp .env.local.example .env.local  # then fill in values, or use the defaults if you're on this account
npm run dev
```

### AWS configuration (`.env.local`)

| Variable | Purpose |
| --- | --- |
| `AWS_PROFILE` | Local AWS CLI/SSO profile used to sign S3 requests |
| `AWS_REGION` | Region of the S3 bucket |
| `S3_BUCKET` | Bucket that stores uploaded photos/videos |

The bucket is private (no public access) — the app generates short-lived presigned URLs for both uploads (PUT) and viewing (GET). If your SSO session expires, run:

```bash
aws sso login --profile davenport
```

## How media storage works
- Uploads go directly from the browser to S3 via a presigned PUT URL (`/api/media/presign`), then the app registers metadata (`/api/media`).
- The gallery list (`GET /api/media`) reads `data/media.json` and generates fresh presigned GET URLs for each item on every request.
- **Sync with S3**: the app can scan the bucket and diff it against `data/media.json` — files added directly to the bucket (outside the app) show up as importable, and gallery entries whose file was deleted from the bucket are flagged for removal. Use the "Sync with S3" panel in the UI.

## Next steps
- Replace demo auth with Amazon Cognito
- Move metadata to DynamoDB
- Add map-based browsing

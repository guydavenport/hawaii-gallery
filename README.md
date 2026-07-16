# Hawaii Gallery

A private gallery app for photos and videos from a Hawaii trip.

## Stack
- Next.js
- Auth: Amazon Cognito for the admin account; a single shared password (no account) for guest view-only access
- Media storage: S3 (private bucket, presigned URLs)
- Metadata storage: DynamoDB (`hawaii-gallery-media` table)
- Hosting: AWS Amplify Hosting (Lambda-based SSR compute)

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
| `AWS_REGION` | Region of the S3 bucket and Cognito user pool |
| `S3_BUCKET` | Bucket that stores uploaded photos/videos |
| `COGNITO_USER_POOL_ID` | Cognito user pool used for admin sign-in |
| `COGNITO_CLIENT_ID` | Cognito app client (no secret) used for admin sign-in |
| `SESSION_SECRET` | Random secret used to sign session cookies — generate with `openssl rand -hex 32` |
| `GUEST_PASSWORD` | Shared password for guest (view-only) access — sign in with no email |
| `DYNAMODB_TABLE` | DynamoDB table storing media metadata (`hawaii-gallery-media`) |

Two account types: **admin** (email + Cognito password — can upload, sync, edit descriptions, and hide items from guests) and **guest** (leave the email field blank, enter `GUEST_PASSWORD` — view-only, sees only non-hidden items). Admin accounts are created manually (no public sign-up):
```bash
aws cognito-idp admin-create-user --user-pool-id <POOL_ID> --username <email> \
  --user-attributes Name=email,Value=<email> Name=email_verified,Value=true \
  --message-action SUPPRESS --profile davenport --region us-east-1
aws cognito-idp admin-set-user-password --user-pool-id <POOL_ID> --username <email> \
  --password '<temp-password>' --permanent --profile davenport --region us-east-1
```

The bucket is private (no public access) — the app generates short-lived presigned URLs for both uploads (PUT) and viewing (GET). If your SSO session expires, run:

```bash
aws sso login --profile davenport
```

## How the app works
- **Media storage**: uploads go directly from the browser to S3 via a presigned PUT URL (`/api/media/presign`, admin-only page at `/admin`), then the app registers metadata in DynamoDB (`/api/media`). The gallery list (`GET /api/media`) reads DynamoDB and generates fresh presigned GET URLs for each item on every request — the bucket itself is never public.
- **Sync with S3** (`/admin`): scans the bucket and diffs it against DynamoDB — files added directly to the bucket (outside the app) show up as importable, and gallery entries whose file was deleted from the bucket are flagged for removal.
- **Gallery view** (`/`): grouped by day in Hawaii local time, oldest to newest. Click any item for a full-screen lightbox with prev/next (click, on-screen arrows, or ← →). Admins get inline "Edit" (description) and "Hide from guests" controls on every card.
- **Map** (`/map`): groups photos by location (averaged GPS coordinates), pins sized by photo count, click a pin to browse thumbnails and open the lightbox. Uses Leaflet + OpenStreetMap tiles — no API key required.

## Importing photos from the Mac's Photos library

`scripts/import-from-photos.ts` pulls new photos/videos straight out of the local Photos app library, converts HEIC to JPEG for browser compatibility, uploads them to S3, and registers them in the gallery — using each photo's actual capture date, GPS-derived place name, and on-device AI caption (Apple's `ai_caption`) as the description.

**One-time setup:**
- Grant Full Disk Access to your terminal/VS Code in System Settings > Privacy & Security > Full Disk Access (needed to read the Photos library database).
- `python3.11+` is required (the system's Python 3.9 doesn't work) — a venv is created at `.venv-photos/` the first time via:
  ```bash
  /opt/homebrew/bin/python3.12 -m venv .venv-photos
  .venv-photos/bin/pip install osxphotos
  ```

**Usage:**
```bash
npm run import-photos -- --date 2026-07-03      # import a single day
npm run import-photos -- --since 2026-07-03     # import everything from that date onward
npm run import-photos                            # import everything since the last run (recurring use)
npm run import-photos -- --dry-run               # preview what would be imported, no upload
```

## Importing photos shared by others (WhatsApp, AirDrop, etc.)

`scripts/import-from-downloads.ts` picks up any file in `~/Downloads` matching WhatsApp's export naming (`WhatsApp Image/Video YYYY-MM-DD at HH.MM.SS...`), uploads it to S3, and registers it with the capture time parsed from the filename (WhatsApp strips EXIF/GPS, so there's no location or AI caption — just Hawaii + the date). Dedupes by filename, so re-running is safe.

```bash
npx tsx scripts/import-from-downloads.ts --owner "Marite"              # import, crediting a specific photographer
npx tsx scripts/import-from-downloads.ts --owner "Marite" --dry-run    # preview only
```

The script tracks progress in `data/photo-import-state.json` and dedupes by the Photos library's own UUID (stored as `sourceUuid` on each media item), so re-running with an overlapping or unbounded range is always safe — already-imported items are skipped automatically. Run it with no arguments whenever new trip photos land in Photos.app.

## Deployment (AWS Amplify Hosting)

Live at **https://hawaii.daveneti.photos** (also reachable at https://main.d17uzi04qfmafw.amplifyapp.com) — deployed on AWS Amplify Hosting (app `d17uzi04qfmafw`, account 648372317920/`davenport`, us-east-1), connected to this GitHub repo with auto-deploy on push to `main`.

**Custom domain**: `hawaii.daveneti.photos` is a CNAME to Amplify's CloudFront distribution, added via a domain association (`aws amplify create-domain-association`, AMPLIFY_MANAGED cert). The DNS zone for `daveneti.photos` lives in a *different* AWS account (`daveneti`, 605642789297, ap-southeast-2) than the Amplify app, so the cert-validation and subdomain CNAME records were added there manually rather than auto-managed — if the domain is ever re-created, re-fetch the records with `aws amplify get-domain-association --app-id d17uzi04qfmafw --domain-name daveneti.photos --profile davenport` and add them via Route 53 in the `daveneti` profile.

**Runtime config gotcha:** Amplify's console/CLI "Environment variables" for this app never actually reach the Next.js SSR compute's `process.env` at runtime (confirmed by direct inspection — present at build time, absent at request time, regardless of compute role configuration). Rather than depend on that, app config is stored directly in SSM Parameter Store under `/hawaii-gallery/prod/` and fetched explicitly on first use per warm Lambda container (see `app/lib/runtime-config.ts`). To change a config value in production:
```bash
aws ssm put-parameter --name "/hawaii-gallery/prod/<NAME>" --value "<value>" \
  --type String --overwrite --profile davenport --region us-east-1
```
(use `--type SecureString` for `SESSION_SECRET`). Takes effect on the next cold start — redeploy or wait for Lambda to recycle.

**IAM**: the app runs under a dedicated role (`hawaii-gallery-amplify`) trusted by both `amplify.amazonaws.com` and `lambda.amazonaws.com`, scoped to: the S3 media bucket, `cognito-idp:InitiateAuth` on the user pool, the DynamoDB table, the SSM config path above, and CloudWatch Logs.

Auth is enforced per-route (not via Next.js middleware) inside each `/api/media*` handler, since the AWS SDK needed to read SSM isn't safe to bundle into Next's Edge middleware runtime.

**Filesystem gotcha:** Amplify's Lambda-based SSR compute has a **read-only filesystem** outside `/tmp`. The app originally stored metadata in `data/media.json` on disk — reads worked fine in production, but every write (upload registration, sync, edits) was silently failing with an unhandled exception until this was caught and metadata storage was moved to DynamoDB. `data/media.json` and `data/photo-import-state.json` remain in the repo as a point-in-time backup / for the local import script's bookkeeping, but the deployed app no longer reads or writes them.

## Next steps
- Multiple guest passwords / per-guest tracking, if that's ever needed
- Album or trip grouping beyond a single gallery

# Production build and runtime

Target platform (approved architecture): AWS — backend on ECS Fargate behind an ALB, web on S3 + CloudFront,
MongoDB Atlas, secrets in AWS Secrets Manager. The full deployment procedure (infrastructure template, deploy workflow,
secrets, monitoring) is in [`docs/release/DEPLOYMENT_GUIDE.md`](../release/DEPLOYMENT_GUIDE.md); this page summarises
the artefacts and runtime configuration.

## Artefacts

| App     | Build                                                                                                     | Output                                                       | Run                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Backend | `npm run build` (or `docker build -f apps/backend/Dockerfile .`)                                          | `apps/backend/dist`, container image (non-root, healthcheck) | `npm run start:backend` / container `node dist/server.js`                           |
| Web     | `npm run build -w @ahq/web` with production `VITE_API_BASE_URL`                                           | `apps/web/dist` (static)                                     | Upload to S3; serve via CloudFront (`index.html` no-cache, hashed assets immutable) |
| Mobile  | `flutter build appbundle --release --dart-define=API_BASE_URL=https://api.<domain>` / `flutter build ipa` | AAB / IPA                                                    | Store distribution (signing configured in a later phase)                            |

## Backend production configuration

`NODE_ENV=production` enables extra checks — the backend refuses to start if any of these are missing or unsafe:

| Variable                           | Requirement                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `MONGODB_URI`                      | Atlas connection string (replica set, TLS)                                        |
| `JWT_ACCESS_SECRET`                | ≥ 32 random characters, from Secrets Manager                                      |
| `CORS_ORIGINS`                     | Required; exact web origin(s)                                                     |
| `MAIL_TRANSPORT=smtp` + `SMTP_URL` | `log` transport is rejected in production                                         |
| `TRUST_PROXY`                      | Number of proxies in front (1 behind an ALB)                                      |
| `COOKIE_SECURE`                    | Defaults to `true` in production                                                  |
| `GOOGLE_CLIENT_IDS`                | Web, Android, iOS OAuth client ids (optional; disables Google sign-in when empty) |

Health endpoints for load balancers: `GET /health` (liveness), `GET /ready` (database connectivity).

## First administrator

After the first admin has registered and confirmed their email:

```bash
npm run admin:grant -- admin@example.org
```

Run it against the production database from a secured task, not from a laptop.

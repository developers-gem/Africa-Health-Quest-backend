# Deployment guide

**Target (approved architecture):** AWS, one stack per environment (`staging`, `production`):

- the web app on S3 + CloudFront;
- the API and worker on ECS Fargate behind an HTTPS Application Load Balancer, with AWS WAF in front;
- uploaded media in a private S3 bucket;
- the database on MongoDB Atlas;
- secrets in AWS Secrets Manager;
- logs and alarms in CloudWatch.

**Status:** everything below is prepared and checked locally (see §8), but nothing has been deployed to AWS yet.

## 1. Before you start (one-off, per environment)

| Item                                                                          | Notes                                                                                                                                   |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| AWS account per environment, or at least separate stacks                      | Production in its own account is recommended                                                                                            |
| A VPC with 2 public and 2 private subnets in different AZs, and NAT egress    | Tasks call Atlas, Anthropic, FCM, SMTP and Google                                                                                       |
| Domains on one registrable domain, e.g. `play.example.org`, `api.example.org` | Refresh cookies are `SameSite=Strict`, so web and API must be same-site                                                                 |
| ACM certificates                                                              | Web certificate in **us-east-1** (CloudFront); API certificate in the stack's region                                                    |
| ECR repository                                                                | e.g. `ahq-backend`; turn on image scanning                                                                                              |
| MongoDB Atlas cluster                                                         | See [DATABASE_BACKUP_GUIDE.md](DATABASE_BACKUP_GUIDE.md) §1                                                                             |
| SMTP provider                                                                 | e.g. Amazon SES SMTP credentials; verify the sender domain (SPF, DKIM, DMARC)                                                           |
| Optional                                                                      | Anthropic API key (AI debriefs), Firebase project (push), Google OAuth client IDs (Google sign-in)                                      |
| GitHub                                                                        | Repository connected; environments `staging` and `production` (production with required reviewers); an OIDC deploy role per environment |

## 2. Secrets

Create one Secrets Manager secret per environment, as JSON. Every key must exist; use `""` for an optional key you
don't use.

```json
{
  "MONGODB_URI": "mongodb+srv://ahq-app:<password>@<cluster>/ahq?retryWrites=true&w=majority",
  "JWT_ACCESS_SECRET": "<48+ random characters>",
  "DATA_ENCRYPTION_KEY": "<32 random bytes, base64>",
  "SMTP_URL": "smtps://<user>:<password>@email-smtp.<region>.amazonaws.com:465",
  "ANTHROPIC_API_KEY": "",
  "FIREBASE_SERVICE_ACCOUNT_JSON": ""
}
```

Generate the two keys like this:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**`DATA_ENCRYPTION_KEY` encrypts clinicians' registration numbers.** Losing it makes them unreadable; rotating it
needs a migration. Store a copy offline with the backup runbook.

## 3. Create the stack

Push a first image so the template has something to run:

```bash
docker build -f apps/backend/Dockerfile -t <account>.dkr.ecr.<region>.amazonaws.com/ahq-backend:<git-sha> .
```

```bash
docker push <account>.dkr.ecr.<region>.amazonaws.com/ahq-backend:<git-sha>
```

Then create the stack:

```bash
aws cloudformation deploy --stack-name ahq-production \
  --template-file infra/aws/africa-health-quest.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides EnvironmentName=production WebDomainName=play.example.org ApiDomainName=api.example.org \
    WebCertificateArn=<us-east-1 cert> ApiCertificateArn=<regional cert> VpcId=<vpc> \
    PublicSubnetIds=<a,b> PrivateSubnetIds=<a,b> ImageUri=<image uri> AppSecretArn=<secret arn> \
    MailFrom="Africa Health Quest <no-reply@example.org>" AiProvider=disabled AlarmEmail=ops@example.org
```

After the stack is created:

1. Point DNS at the outputs: `play` → `WebDistributionDomain`, `api` → `ApiLoadBalancerDns` (alias records).
2. Confirm the SNS email subscription for alarms.
3. Allow the NAT gateway's public IPs in the Atlas IP access list, or use VPC peering or PrivateLink.
4. Set the GitHub environment variables listed at the top of `.github/workflows/deploy.yml` from the stack outputs.

## 4. Deploy (every release)

Actions → **Deploy** → choose the environment → run, from a commit on `main` that passed CI. Production waits for a
reviewer's approval.

The workflow:

1. Builds the image, tagged with the commit SHA, and pushes it.
2. Rolls out the API: health-checked on `/ready`, and the circuit breaker rolls back automatically on failure.
3. Rolls out the worker.
4. Smoke-tests `/health`, `/ready` and `/api/v1/countries`.
5. Builds the web app and uploads it. Hashed assets are immutable, `index.html` is never cached, and source maps are
   kept as a CI artefact instead of being published.
6. Invalidates `index.html` in CloudFront.

**Rollback.** In ECS, update each service to the previous task definition revision. For the web app, re-run the
workflow on the previous commit; old hashed assets are never deleted.

## 5. After the first deployment

1. Seed reference data (roles, settings, the 54 countries, and the prototype cases as drafts awaiting review). Run it
   as a one-off ECS task with the API task definition:

   ```bash
   aws ecs run-task --cluster <cluster> --launch-type FARGATE --task-definition ahq-production-api \
     --network-configuration "awsvpcConfiguration={subnets=[<private-a>],securityGroups=[<task-sg>]}" \
     --overrides '{"containerOverrides":[{"name":"api","command":["node","dist/scripts/seed.js"]}]}'
   ```

2. The first administrator registers on the website and confirms their email. Then run
   `node dist/scripts/grant-admin.js <email>` the same way. They must set up two-factor authentication at first
   sign-in.
3. Follow [ADMIN_USER_GUIDE.md](ADMIN_USER_GUIDE.md):
   - verify clinicians;
   - assign reviews;
   - set the AI budget, if AI is on;
   - tag cases with topics.
4. Work through [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md).

## 6. Configuration rules the server enforces

With `NODE_ENV=production`, the API **refuses to start** if any of these are not met:

- `CORS_ORIGINS` is set;
- mail goes over SMTP (`MAIL_TRANSPORT=smtp` with an `SMTP_URL`);
- media goes to S3 (`MEDIA_STORAGE_DRIVER=s3` with `S3_MEDIA_BUCKET` and `AWS_REGION`);
- `RATE_LIMIT_STORE=mongo`;
- the fake AI provider is not used;
- the secrets are strong enough.

Cookies are `Secure` in production. The template sets all of this.

## 7. Monitoring, logging and error tracking

| What                  | Where                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API and worker logs   | CloudWatch `/ahq/<env>/api` and `/worker`: JSON (pino) with `requestId`; tokens, cookies and passwords redacted; 400-day retention in production                    |
| Server error tracking | Logged errors become a metric (`{ $.level >= 50 }`) and alarm at 5 or more per 5 min (API) or 3 or more (worker). Look a request up by `requestId` in Logs Insights |
| Alarms (SNS email)    | API errors, ALB 5xx, p95 latency over 1 s, unhealthy targets, worker not running                                                                                    |
| Metrics               | ECS Container Insights; ALB; WAF (blocked requests per rule); AI usage and cost in the admin console                                                                |
| Client error tracking | **Not set up.** Web and mobile crashes are not collected. Recommended: Sentry (needs an account and DSN — owner decision) or Firebase Crashlytics for the apps      |

## 8. What was verified before release, and what wasn't

**Verified locally**

- **The compiled API and worker in production mode,** run against MongoDB, an S3-compatible server and SMTP: security
  headers, the CORS allow-list and log redaction all behave.
- **The CloudFormation template** passes `cfn-lint`.
- **The website's security policy (CSP) and SPA routing,** served exactly as configured: no CSP violations on public,
  player and deep-linked pages.

**Not verified**

- An actual AWS deployment.
- Building the container image here: the base image download is blocked in this environment. The CI `docker` job
  builds it.
- The deploy workflow has never run, because no repository is connected.

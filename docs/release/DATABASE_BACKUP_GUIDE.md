# Database and backup guide (MongoDB Atlas)

**Targets** (system architecture): RPO ≤ 15 minutes, RTO ≤ 4 hours, plus a quarterly restore drill.

**Status:** this is the configuration to apply. No Atlas production cluster exists yet, and no restore drill has been
run.

## 1. Production cluster

| Setting            | Value                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Tier               | M30 or larger for production (M10 for staging). Resize when CPU stays above 60% or the working set no longer fits in RAM |
| Topology           | 3-node replica set across 3 zones, in the same AWS region as the API. Transactions require a replica set                 |
| Version            | MongoDB 8.x (CI and local development use the same major)                                                                |
| Network            | VPC peering or PrivateLink to the API VPC, or an IP access list with only the NAT gateway IPs. Never `0.0.0.0/0`         |
| TLS                | Required (Atlas default)                                                                                                 |
| Encryption at rest | Atlas default; customer-managed KMS keys optional                                                                        |
| Auth               | SCRAM users, one per purpose (below)                                                                                     |
| Database name      | `ahq`, set in the connection string                                                                                      |

### Database users (least privilege)

| User           | Role                              | Used by                                                                         |
| -------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| `ahq-app`      | `readWrite` on `ahq` only         | API and worker (via `MONGODB_URI` in Secrets Manager)                           |
| `ahq-readonly` | `read` on `ahq`                   | Incident investigation and analytics exports; time-limited, granted when needed |
| Atlas admins   | Atlas organisation roles with MFA | Two named people; never used by applications                                    |

`ahq-app` can create indexes on its own database. Mongoose creates missing indexes at startup, which is fine at
launch scale. For large collections later, build indexes ahead of a deploy in a maintenance window.

## 2. Backups

| What                     | Setting                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud Backup             | On, with **continuous backup (point-in-time recovery) for 7 days**. This meets the 15-minute RPO                                                        |
| Snapshot schedule        | Every 6 h (kept 2 days), daily (7 days), weekly (8 weeks), monthly (12 months)                                                                          |
| Backup copy              | Copy snapshots to a second region (Atlas multi-region snapshot distribution)                                                                            |
| Backup compliance policy | On in production, so snapshots can't be deleted early, even by an admin                                                                                 |
| Media                    | The S3 media bucket is versioned; old versions are kept 90 days. Add S3 Cross-Region Replication if regional loss must be covered                       |
| Secrets                  | Keep a copy of `DATA_ENCRYPTION_KEY` offline (sealed, two custodians). Without it, encrypted clinician registration numbers in a restore are unreadable |

## 3. What lives where

**Kept long term** (system of record):

- users;
- player profiles and progress, and the rewards ledger;
- mission attempts;
- missions, versions, reviews and assignments;
- clinical references;
- countries and settings;
- the audit log;
- AI debriefs;
- media metadata.

**Expire automatically** (TTL indexes):

| Data                | Expiry                   |
| ------------------- | ------------------------ |
| Sessions            | When the session expires |
| Email tokens        | When the token expires   |
| Idempotency records | When the record expires  |
| Sync events         | 90 days                  |
| Notifications       | 180 days                 |
| Device tokens       | 270 days unused          |
| AI usage logs       | 400 days                 |
| AI debriefs         | 730 days                 |
| Rate-limit counters | 1 window after reset     |

The worker also purges inactive guests (`GUEST_TTL_DAYS`) and expires abandoned attempts (`ATTEMPT_MAX_AGE_DAYS`).

A point-in-time restore brings back data that later expired or was erased. See §5.

## 4. Restore runbook

**Never restore over production first.**

1. **Declare the incident.** Pick the target time: just before the bad write. The audit log and the logs' `requestId`
   help find it.
2. **Restore to a new cluster** (Atlas → Backup → Restore → point in time → _new cluster_ `ahq-restore-<date>`).
   About 30–90 minutes for a launch-sized database.
3. **Check the restore.** Connect with `ahq-readonly`, then:
   - compare counts of users, attempts and missions;
   - spot-check the incident's records;
   - confirm `platformSettings` and published mission versions.
4. **Choose:**
   - **(a) Repair:** copy the affected documents back with a reviewed script (preferred for a narrow incident).
   - **(b) Cut over:** put the API in maintenance (scale the `api` service to 0 and the worker to 0), point
     `MONGODB_URI` in Secrets Manager at the restored cluster, force a new deployment of both services, then smoke-test.
5. **Afterwards:** rotate `ahq-app`'s password if credentials were involved, then write up what happened.

**RTO budget:** about 1 h for the decision and restore, 1 h for checks, 1 h for the cut-over, plus 1 h spare.

## 5. Erasure and backups

Erasure requests (`POST /admin/users/:id/erase`) remove the person's data from the live database and are audited.
Backups are not rewritten.

- If a restore brings back an erased user, re-run the erasures recorded in the audit log (`user.erased` entries)
  after the restore, before reopening traffic.
- Tell users in the privacy policy that backups are kept for up to 12 months.
- The retention period itself still needs the owner's decision (open since Phase 4).

## 6. Drills and monitoring

**Quarterly restore drill.** Restore to a new cluster, run the step-3 checks, time the whole run, record the result,
and delete the cluster.

**Atlas alerts** (email or PagerDuty):

- replication lag over 60 s;
- disk over 80%;
- CPU over 80% for 15 min;
- connections over 80% of the limit;
- backup failure;
- primary election.

**Weekly:** check the Atlas performance advisor for new index suggestions. At release, every hot query used an index
(see TESTING_REPORT.md §4).

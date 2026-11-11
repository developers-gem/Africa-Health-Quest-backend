# Administrator user guide

**Who this is for:** platform administrators and clinician reviewers.

**Where the work happens:** everything is in the website. Administrators use `/admin`; clinician reviewers use
`/review`. The mobile app is for players only.

**What admins can't do:** approve clinical content. Only verified clinician reviewers can.

## 1. Getting in

1. **Register** with your work email on the website and confirm the emailed link.
2. **Get admin rights.** The first administrator is granted by the operations team (`grant-admin` script,
   DEPLOYMENT_GUIDE §5). After that, administrators grant roles to each other under **Users**.
3. **Set up two-factor authentication.** At first sign-in, scan the QR code with an authenticator app (Google
   Authenticator, Microsoft Authenticator, 1Password…). Then save the recovery codes somewhere safe: each works once
   if you lose your phone.
4. **Expect re-confirmation.** Sensitive actions ask you to confirm your password or code again if your last sign-in
   was more than 15 minutes ago. These are role changes, suspensions, erasure, settings and clinician verification.
5. **Expect to be signed out when roles change.** A role change signs that person out everywhere. They sign in again
   with their new access.

Every staff action is recorded in the **Audit log** (`/admin/audit`): who, what, before and after, and why.

## 2. Overview (`/admin`)

Shows:

- player counts;
- active players;
- cases played and pass rate;
- the review queue;
- pending clinician applications;
- AI spend.

Start each day here.

## 3. People

### Users (`/admin/users`)

- Search by email or name; filter by role or status.
- On a user's page you can:
  - **change roles** (player, reviewer, admin);
  - **suspend or unsuspend** (signs them out; give a reason);
  - **sign out all sessions**;
  - **adjust HP or funding** (with a reason; recorded in their rewards ledger);
  - **erase** (permanent deletion of personal data on request; type the confirmation; audited).
- Erasure does not rewrite backups (DATABASE_BACKUP_GUIDE §5).

### Clinicians (`/admin/clinicians`)

Clinicians apply from their profile (`/review/profile`) with:

- profession;
- credentials;
- licensing body;
- registration number (stored encrypted);
- evidence documents (PDF or image).

To verify a clinician:

1. Open the application. The registration number is shown decrypted to you only, and the evidence opens as a download.
2. **Check the registration number with the licensing body's public register.** The platform cannot do this for you.
3. Choose **Verify** or **Reject** with a reason. You can't verify yourself.
4. To let a verified clinician review cases, also give them the **reviewer** role under Users.

To withdraw a reviewer, remove the role or reject the profile. Decisions they already made stay in the history.

## 4. Clinical content: from draft to players

```
Admin drafts → submits for review → admin assigns a reviewer → clinician checks scenario, treatment, references
→ approves (published to players) or requests changes → admin edits → resubmits …
```

**1. Author** (`/admin/missions` → **New mission**, or open a mission → **New draft**):

- Write the story and learning objectives.
- For each of 1–10 steps, write 2–6 choices. Exactly one is correct; each choice has feedback, and a choice can be
  marked _critical_ (dangerous).
- Attach clinical references from the reference library.
- **Save** keeps the draft.

**2. Submit for review:**

- Add a short change summary.
- The version is frozen from then on. Its content gets a fingerprint, and any later change needs a new draft.

**3. Assign** (`/admin/publishing`):

- Pick a verified reviewer who did not author the version.
- The **approval monitoring** panel at the top shows:
  - the queue and the oldest item;
  - edits waiting for re-approval;
  - active reviewers;
  - overdue assignments;
  - published cases with no reference.

**4. Review** (clinicians, `/review`):

- The reviewer inspects the scenario, the full treatment pathway and the references.
- They can add or confirm references in the **reference library**.
- To approve, all three checks (scenario, treatment, references) must be ticked and at least one reference chosen.
- Otherwise they **request changes** with notes; the draft returns to you.

**5. Approval publishes immediately.**

- Players see the new version for new attempts.
- Attempts already in progress finish on the version they started.
- Offline downloads of the old version are flagged as conflicts when they sync.

**6. Editing a published case never changes what players see.**

- An edit creates a new draft that needs a new approval.
- The previous approval does not carry over.

**7. Publishing controls** (`/admin/missions/:key`):

- **Placement:** country, tier, order, topics.
- **Available offline:** off by default; turn it on only for cases suitable for download.
- **Withdraw:** hides it from players immediately, e.g. after a safety concern. Debriefs for it stop too.
- **Restore.**
- **Roll back** to an earlier approved version.
- **Retire.**
- The version history and **diff** show exactly what changed between versions.

**Tag topics.** AI debriefs recommend practice topics only from tags on published cases. Untagged cases give no
recommendations.

## 5. Countries (`/admin/countries`)

For each of the 54 countries you can set:

- its status (coming soon or active);
- descriptions and health priorities;
- the flag and image (upload; the type is checked and metadata is stripped);
- unlock rules (HP required);
- which missions belong to it.

Activation applies to players immediately.

## 6. Game configuration (`/admin/configuration`)

Versioned settings. Each save creates a new version with a note, and you can see the history.

| Tab                | What it controls                                                        |
| ------------------ | ----------------------------------------------------------------------- |
| Economy            | HP and funding rewards per case, the first-pass bonus, practice rewards |
| Levels             | Hospital tiers and the HP needed for each                               |
| Hospital Commander | Unit cost, resource limits, rewards per need met                        |
| Emergencies        | Commander emergency events and their needs                              |
| Achievements       | Achievement definitions and thresholds                                  |

Changes affect new attempts and shifts, never past results.

## 7. AI debriefs (`/admin/ai`)

**Provider card.** Shows:

- the provider;
- whether a server key is configured (the key is never shown);
- the model;
- the fallback model;
- the prompt version;
- whether debriefs are currently available.

**Settings:**

- **Kill switch:** stops all new debriefs immediately; existing ones stay readable.
- **Model and effort.** Re-run the evaluation (`npm run ai:eval`) and get clinician sign-off before changing them.
- **Daily quotas** (registered players and guests) and the **per-minute limit**.
- **Monthly budget cap:** debriefs pause when it's reached.
- **Fallback model:** tried once when the main model is unavailable. Off by default.
- **Prices:** used for cost tracking.

**Usage:**

- spend this month against the cap;
- calls, cost per debrief, tokens and failures by kind;
- usage by learner level;
- requests stopped by player limits.

**Reported debriefs.** Players can report a debrief. Clinicians see reports at `/review/ai-flags`. If a pattern
appears, use the kill switch and review the prompt.

## 8. Announcements (`/admin/announcements`)

Send an in-app notification, plus push where configured, to all players or to specific roles or countries.
Announcements are audited. Keep them short and educational. No patient data.

## 9. Analytics, reports and audit

- **Analytics** (`/admin/analytics`): pass rates, the guest-to-account funnel, and choice distribution per step. Use
  it to find confusing cases and send them back to clinicians.
- **Reports** (`/admin/reports`): CSV downloads of analytics, AI usage and the audit log.
- **Audit log** (`/admin/audit`): filter by person, action or date. Use it for investigations and erasure records.

## 10. When something goes wrong

| Situation                              | Do this                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A case is found to be clinically wrong | **Withdraw** it now (Missions → the case), then create a corrected draft and send it for review          |
| AI debriefs look wrong or unsafe       | AI settings → **kill switch** off; tell the clinical lead; check reported debriefs                       |
| AI spend is rising fast                | Lower quotas, or set the budget cap; check usage by level and the per-minute limit                       |
| A compromised staff account            | Users → suspend → sign out all sessions; check the audit log for its actions; reset its password and 2FA |
| A player asks for deletion             | Users → erase (after verifying the request comes from the account's email)                               |
| Players report the app is down         | Tell the operations team. They watch the CloudWatch alarms (DEPLOYMENT_GUIDE §7)                         |

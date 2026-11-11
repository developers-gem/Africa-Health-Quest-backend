# Lovable prototype (reference only)

Read-only copies from the original Lovable/Supabase prototype, kept so later phases can migrate
content **word for word** and preserve gameplay rules. Nothing here is built, linted or deployed.

| File                 | Used by                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| `game-data.ts`       | Phase 2 seed: 10 missions, 5 countries, 4 tiers (text must be preserved verbatim)      |
| `debrief.server.ts`  | Phase 4: the four-section debrief prompt structure                                     |
| `review.ts`, `*.sql` | Phase 5: review rules (3 checks + ≥1 reference to approve; content change invalidates) |
| `hero.jpg`           | Phase 6/8: home-screen hero image                                                      |

Gameplay rules to preserve (from `src/routes/index.tsx`):

- 25 points per correct step; "patient saved" at ≥ 50% of the maximum.
- First completion: HP += score; replay: HP += 30% of score. Funding += round(score / 2).
- Starting save: 0 HP, ₵100 funding.
- Story missions are locked if `mission.tier > current tier` or `HP < country.need`.
- Commander: ₵10 per allocated unit; per need covered → +15 HP and +₵8.

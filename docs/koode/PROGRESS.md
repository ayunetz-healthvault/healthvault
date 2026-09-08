# Koode implementation progress

Planning package prepared 8 September 2026. No application implementation or live deployment was performed by this package. No repository test suite was run for this documentation-only change.

Statuses: Not started / In progress / Implemented locally / Blocked / Verified. Use **Verified** only when the story's acceptance evidence is satisfied. Split external gates into explicit checklist items; do not obscure a missing live test by closing the parent story.

| Story | Status | Evidence / blocker |
| --- | --- | --- |
| KOO-00 | Not started | Baseline supplied; reconcile with actual checkout |
| KOO-01 | Not started | Approved interactive design bundled |
| KOO-02 | Not started | |
| KOO-03 | Not started | |
| KOO-04 | Not started | |
| KOO-05 | Not started | |
| KOO-06 | Not started | |
| KOO-07 | Not started | |
| KOO-08 | Not started | |
| KOO-09 | Not started | |
| KOO-10 | Not started | |
| KOO-11 | Not started | |
| KOO-12 | Not started | |
| KOO-13 | Not started | |
| KOO-14 | Not started | Cloud execution/credentials must be verified in implementing session |
| KOO-15 | Not started | |

## Per-story evidence template

### KOO-XX — title

- Date / branch / starting commit:
- Scope and child tasks:
- Existing implementation reused:
- Changes and commit links:
- Acceptance criteria satisfied:
- Commands actually run and outcomes:
- Synthetic fixture / UI / device evidence:
- Baseline failures or skipped checks:
- External gates still unverified:
- Decisions / ADRs / migration / rollback:
- Next precise action:

## Initial release gates

- [ ] App and backend verification on the final implementation
- [ ] Separate parent/caregiver accounts and cross-record access tests
- [ ] Encrypted local records/files and account-switch checks
- [ ] Durable sync and upload recovery
- [ ] Queue worker and real-provider compatibility evidence
- [ ] Source review and medicine/task confirmation
- [ ] Consent, access withdrawal, export and deletion behavior
- [ ] Native design/accessibility acceptance
- [ ] Authorized cloud environment/security/restore/cost evidence
- [ ] Privacy/legal/provider/operational acceptance for any real-patient pilot

## Resume checkpoint

Start with KOO-00. Read CLAUDE_PROMPT.md and the repository's current instructions. All application work remains to be implemented or reconciled against newer code.

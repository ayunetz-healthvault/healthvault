/**
 * Runs the ADR-005 migration.
 *
 *   npx tsx scripts/migrateToPatientPartitions.ts --owner <accountId> [...]
 *   npx tsx scripts/migrateToPatientPartitions.ts --owner <accountId> --apply
 *
 * Dry run by default. Without `--apply` nothing is written and the plan is
 * printed, which is the only sane default for a script that touches medical
 * records.
 *
 * The migration is additive — see `patientPartitions.ts`. Source items are
 * never deleted, so rollback is "stop reading the new partitions" and needs no
 * second script.
 */
import { loadStackConfig } from '../src/config/stack.js';
import { migrateOwnerToPatientPartitions } from '../src/services/migration/patientPartitions.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const ownerIds = args.flatMap((value, index) => (args[index - 1] === '--owner' ? [value] : []));

if (ownerIds.length === 0) {
  // eslint-disable-next-line no-console
  console.error('Name at least one account with --owner <accountId>.');
  process.exit(1);
}

const stack = loadStackConfig();

/**
 * A second pair of eyes before writing to a production table.
 *
 * `AYUNETZ_STACK=aws` plus `--apply` is the combination that changes real
 * people's records, so it needs one more deliberate act than a typo can supply.
 */
if (apply && stack.name === 'aws' && process.env.AYUNETZ_MIGRATION_CONFIRM !== 'yes-i-am-sure') {
  // eslint-disable-next-line no-console
  console.error(
    'Refusing to apply against the aws stack without AYUNETZ_MIGRATION_CONFIRM=yes-i-am-sure.',
  );
  process.exit(1);
}

const report = await migrateOwnerToPatientPartitions(stack, { ownerIds, apply });

// eslint-disable-next-line no-console
console.log(apply ? 'Applied.' : 'Dry run — nothing was written.');
// eslint-disable-next-line no-console
console.table(
  report.planned.map((entry) => ({
    patient: entry.patientId,
    // Names are printed only on a dry run against the local stack, where the
    // data is synthetic. This is an operator's console, not a log.
    documents: entry.documentCount,
    followUps: entry.followUpCount,
    processing: entry.hasProcessing,
    summaries: entry.hasSummary,
    alreadyMigrated: entry.alreadyMigrated,
  })),
);
// eslint-disable-next-line no-console
console.log(
  `${report.planned.length} record(s); ${report.itemsWritten} item(s) written; ` +
    `${report.grantsCreated} grant(s) created.`,
);
if (report.skipped.length > 0) {
  // eslint-disable-next-line no-console
  console.warn('Skipped:', report.skipped);
}

import { execFileSync } from 'node:child_process';

function runRg(args) {
  return execFileSync('rg', args, { encoding: 'utf8' });
}

const checks = [
  {
    name: 'raw console.error(err/error/e)',
    args: [
      '-n',
      '--glob',
      '!.next/**',
      '--glob',
      '!node_modules/**',
      '--glob',
      '!src/lib/safeLogger.ts',
      '--glob',
      '!src/lib/requestLog.ts',
      String.raw`console\.error\(\s*(err|error|e)\s*\);`,
      'src/app/api',
      'src/lib',
    ],
  },
  {
    name: 'alexaEvents must not read raw response text',
    args: ['-n', String.raw`res\.text\(`, 'src/lib/alexaEvents.ts'],
    allowNoMatches: true,
  },
];

let failed = false;

for (const check of checks) {
  try {
    const out = runRg(check.args);
    if (out.trim()) {
      // If we got matches, this check fails unless allowNoMatches is set (it is not).
      failed = true;
      process.stdout.write(`\n[check:logs] FAIL: ${check.name}\n`);
      process.stdout.write(out);
    }
  } catch (err) {
    // rg exits with code 1 when there are no matches (that's success for most checks here).
    // For allowNoMatches=false, "no matches" is success.
    const code = err && typeof err === 'object' && 'status' in err ? err.status : null;
    if (code === 1) {
      // no matches
      continue;
    }
    if (check.allowNoMatches) {
      continue;
    }
    failed = true;
    process.stdout.write(`\n[check:logs] ERROR running check: ${check.name}\n`);
    process.stdout.write(String(err));
  }
}

if (failed) {
  process.exit(1);
}

process.stdout.write('[check:logs] OK\n');


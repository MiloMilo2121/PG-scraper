import * as fs from 'fs';
import { AgentRunRegistry } from './agent_run_registry';

interface InspectFlags {
  runId?: string;
  rootDir?: string;
  list?: boolean;
  limit?: number;
  status?: string;
}

function parseArgs(argv: string[]): InspectFlags {
  const out: InspectFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--run-id':
        out.runId = next;
        i++;
        break;
      case '--root-dir':
        out.rootDir = next;
        i++;
        break;
      case '--list':
        out.list = true;
        break;
      case '--limit': {
        const parsed = Number.parseInt(next ?? '', 10);
        if (Number.isFinite(parsed) && parsed > 0) out.limit = parsed;
        i++;
        break;
      }
      case '--status':
        out.status = next;
        i++;
        break;
      default:
        break;
    }
  }
  return out;
}

async function main(): Promise<number> {
  const flags = parseArgs(process.argv.slice(2));
  const registry = new AgentRunRegistry({ rootDir: flags.rootDir });

  if (flags.list) {
    const entries = registry.list({
      limit: flags.limit ?? 20,
      status: flags.status as never,
    });
    process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
    return 0;
  }

  if (!flags.runId) {
    process.stderr.write(
      'Usage: agent_inspect_cli --run-id <id> [--root-dir <dir>]\n' +
        '       agent_inspect_cli --list [--status <status>] [--limit N]\n'
    );
    return 1;
  }

  const entry = registry.get(flags.runId);
  if (!entry) {
    process.stdout.write(JSON.stringify({ runId: flags.runId, found: false }, null, 2) + '\n');
    return 1;
  }

  const reportPath = entry.result?.artifacts?.reportJson;
  let report: unknown = null;
  if (reportPath && fs.existsSync(reportPath)) {
    try {
      report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    } catch {
      report = null;
    }
  }

  process.stdout.write(
    JSON.stringify({ entry, report }, null, 2) + '\n'
  );
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`Fatal: ${(err as Error).message}\n`);
      process.exit(1);
    });
}

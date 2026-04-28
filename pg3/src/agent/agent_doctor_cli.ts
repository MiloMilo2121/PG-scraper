import { runAgentDoctor } from './agent_doctor';

interface DoctorFlags {
  projectRoot?: string;
  rootDir?: string;
  checkRedis?: boolean;
  redisUrl?: string;
}

function parseArgs(argv: string[]): DoctorFlags {
  const out: DoctorFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--project-root':
        out.projectRoot = next;
        i++;
        break;
      case '--root-dir':
        out.rootDir = next;
        i++;
        break;
      case '--check-redis':
        out.checkRedis = true;
        break;
      case '--redis-url':
        out.redisUrl = next;
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
  const result = await runAgentDoctor(flags);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result.status === 'failed' ? 1 : 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`Fatal: ${(err as Error).message}\n`);
      process.exit(1);
    });
}


import * as fs from 'fs';
import * as path from 'path';

const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export interface RunPaths {
  runDir: string;
  inputCsv: string;
  outputCsv: string;
  reportJson: string;
  logFile: string;
  costLedger: string;
}

export function defaultRunsRoot(): string {
  return path.resolve(
    process.env.AGENT_RUNS_ROOT || path.join(process.cwd(), 'output', 'runs')
  );
}

function assertSafeRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(
      `Invalid runId "${runId}": must match ${RUN_ID_PATTERN.source}`
    );
  }
}

export function resolveRunPaths(runId: string, opts?: { rootDir?: string }): RunPaths {
  assertSafeRunId(runId);
  const root = opts?.rootDir ? path.resolve(opts.rootDir) : defaultRunsRoot();
  const runDir = path.join(root, runId);

  const resolvedRunDir = path.resolve(runDir);
  const resolvedRoot = path.resolve(root);
  if (!resolvedRunDir.startsWith(resolvedRoot + path.sep) && resolvedRunDir !== resolvedRoot) {
    throw new Error(`runId "${runId}" resolves outside the runs root`);
  }

  return {
    runDir: resolvedRunDir,
    inputCsv: path.join(resolvedRunDir, 'input.csv'),
    outputCsv: path.join(resolvedRunDir, 'output.csv'),
    reportJson: path.join(resolvedRunDir, 'report.json'),
    logFile: path.join(resolvedRunDir, 'run.log'),
    costLedger: path.join(resolvedRunDir, 'cost_ledger.jsonl'),
  };
}

export function ensureRunDir(runId: string, opts?: { rootDir?: string }): RunPaths {
  const paths = resolveRunPaths(runId, opts);
  fs.mkdirSync(paths.runDir, { recursive: true });
  return paths;
}

export function writeReportJson(paths: RunPaths, payload: unknown): void {
  fs.mkdirSync(path.dirname(paths.reportJson), { recursive: true });
  fs.writeFileSync(paths.reportJson, JSON.stringify(payload, null, 2), 'utf-8');
}

export function appendRunLog(paths: RunPaths, event: string, payload?: unknown): void {
  fs.mkdirSync(path.dirname(paths.logFile), { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...(payload === undefined ? {} : { payload }),
  });
  fs.appendFileSync(paths.logFile, `${line}\n`, 'utf-8');
}

export function copyInputCsv(sourceCsv: string, paths: RunPaths): string {
  if (!fs.existsSync(sourceCsv)) {
    throw new Error(`sourceCsv not found: ${sourceCsv}`);
  }
  fs.mkdirSync(path.dirname(paths.inputCsv), { recursive: true });
  fs.copyFileSync(sourceCsv, paths.inputCsv);
  return paths.inputCsv;
}

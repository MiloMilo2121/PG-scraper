import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  copyInputCsv,
  ensureRunDir,
  resolveRunPaths,
  writeReportJson,
} from '../../src/agent/agent_artifacts';

describe('agent_artifacts', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg3-agent-artifacts-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('resolveRunPaths is deterministic for the same inputs', () => {
    const a = resolveRunPaths('run-1', { rootDir: tmpRoot });
    const b = resolveRunPaths('run-1', { rootDir: tmpRoot });
    expect(a).toEqual(b);
    expect(a.runDir).toBe(path.resolve(tmpRoot, 'run-1'));
    expect(a.outputCsv).toBe(path.join(a.runDir, 'output.csv'));
  });

  it('rejects malicious runId values that try to escape the runs root', () => {
    expect(() => resolveRunPaths('../etc', { rootDir: tmpRoot })).toThrow();
    expect(() => resolveRunPaths('a/b', { rootDir: tmpRoot })).toThrow();
    expect(() => resolveRunPaths('', { rootDir: tmpRoot })).toThrow();
  });

  it('ensureRunDir creates the run directory', () => {
    const paths = ensureRunDir('run-2', { rootDir: tmpRoot });
    expect(fs.existsSync(paths.runDir)).toBe(true);
  });

  it('writeReportJson persists JSON content', () => {
    const paths = ensureRunDir('run-3', { rootDir: tmpRoot });
    writeReportJson(paths, { ok: true, n: 42 });
    const raw = fs.readFileSync(paths.reportJson, 'utf-8');
    expect(JSON.parse(raw)).toEqual({ ok: true, n: 42 });
  });

  it('copyInputCsv copies the source into the run dir', () => {
    const src = path.join(tmpRoot, 'src.csv');
    fs.writeFileSync(src, 'a,b\n1,2\n', 'utf-8');
    const paths = ensureRunDir('run-4', { rootDir: tmpRoot });
    const target = copyInputCsv(src, paths);
    expect(target).toBe(paths.inputCsv);
    expect(fs.readFileSync(target, 'utf-8')).toBe('a,b\n1,2\n');
  });

  it('copyInputCsv throws when source does not exist', () => {
    const paths = ensureRunDir('run-5', { rootDir: tmpRoot });
    expect(() => copyInputCsv(path.join(tmpRoot, 'missing.csv'), paths)).toThrow(
      /not found/
    );
  });
});

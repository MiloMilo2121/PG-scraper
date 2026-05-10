import fs from 'fs';
import path from 'path';

export class OutputLockError extends Error {
  readonly lockPath: string;

  constructor(lockPath: string, message: string) {
    super(message);
    this.name = 'OutputLockError';
    this.lockPath = lockPath;
  }
}

export interface OutputLockHandle {
  lockPath: string;
  release(): void;
}

interface LockPayload {
  pid: number;
  created_at: string;
  target: string;
  meta?: Record<string, string | number | boolean | undefined>;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

function readLock(lockPath: string): LockPayload | undefined {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8')) as LockPayload;
  } catch {
    return undefined;
  }
}

/**
 * Atomic file lock for long-running CLI outputs.
 *
 * This prevents two enrich/scrape processes from writing the same CSV,
 * JSONL and cost ledger concurrently. A sandboxed `tsx` launch can fail
 * while leaving its child process alive; without this lock a retry may
 * corrupt the output and double-spend paid providers.
 */
export function acquireOutputLock(
  targetPath: string,
  meta: Record<string, string | number | boolean | undefined> = {}
): OutputLockHandle {
  const lockPath = `${targetPath}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const payload: LockPayload = {
    pid: process.pid,
    created_at: new Date().toISOString(),
    target: path.resolve(targetPath),
    meta,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify(payload, null, 2), 'utf8');
      fs.closeSync(fd);
      let released = false;
      return {
        lockPath,
        release() {
          if (released) return;
          released = true;
          try {
            const current = readLock(lockPath);
            if (!current || current.pid === process.pid) fs.unlinkSync(lockPath);
          } catch {
            // Best effort cleanup. A missing lock is already released.
          }
        },
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;

      const existing = readLock(lockPath);
      if (existing && !isProcessAlive(existing.pid)) {
        fs.unlinkSync(lockPath);
        continue;
      }

      const owner = existing ? `pid ${existing.pid}` : 'unknown owner';
      throw new OutputLockError(
        lockPath,
        `Output is already locked by ${owner}: ${lockPath}. Wait for the running process to finish, or remove the lock only after confirming no matching process is active.`
      );
    }
  }

  throw new OutputLockError(lockPath, `Could not acquire output lock: ${lockPath}`);
}

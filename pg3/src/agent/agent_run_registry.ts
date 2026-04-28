import * as fs from 'fs';
import * as path from 'path';
import { defaultRunsRoot } from './agent_artifacts';
import {
  AgentRunStatus,
  AgentScraperRequest,
  AgentScraperResult,
} from './agent_contracts';

export interface RegistryEntry {
  runId: string;
  status: AgentRunStatus;
  mode: AgentScraperRequest['mode'];
  startedAt: string;
  finishedAt?: string;
  request: AgentScraperRequest;
  result?: AgentScraperResult;
}

const REGISTRY_FILE_NAME = '_registry.jsonl';

function registryFilePath(rootDir?: string): string {
  const root = rootDir ? path.resolve(rootDir) : defaultRunsRoot();
  return path.join(root, REGISTRY_FILE_NAME);
}

function ensureRegistryDir(rootDir?: string): string {
  const filePath = registryFilePath(rootDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return filePath;
}

function loadEntries(rootDir?: string): Map<string, RegistryEntry> {
  const filePath = registryFilePath(rootDir);
  const map = new Map<string, RegistryEntry>();
  if (!fs.existsSync(filePath)) {
    return map;
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as RegistryEntry;
      if (entry && entry.runId) {
        map.set(entry.runId, entry);
      }
    } catch {
      // Tolerate corrupted lines — append-only history may be partially written.
    }
  }
  return map;
}

function appendEntry(entry: RegistryEntry, rootDir?: string): void {
  const filePath = ensureRegistryDir(rootDir);
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
}

export class AgentRunRegistry {
  private readonly rootDir?: string;

  constructor(opts?: { rootDir?: string }) {
    this.rootDir = opts?.rootDir;
  }

  register(request: AgentScraperRequest, startedAt: string): RegistryEntry {
    const entry: RegistryEntry = {
      runId: request.runId,
      status: 'running',
      mode: request.mode,
      startedAt,
      request,
    };
    appendEntry(entry, this.rootDir);
    return entry;
  }

  update(runId: string, patch: Partial<RegistryEntry>): RegistryEntry | undefined {
    const entries = loadEntries(this.rootDir);
    const current = entries.get(runId);
    if (!current) return undefined;
    const next: RegistryEntry = { ...current, ...patch, runId };
    appendEntry(next, this.rootDir);
    return next;
  }

  get(runId: string): RegistryEntry | undefined {
    const entries = loadEntries(this.rootDir);
    return entries.get(runId);
  }

  list(filter?: { status?: AgentRunStatus; limit?: number }): RegistryEntry[] {
    const entries = Array.from(loadEntries(this.rootDir).values());
    const filtered = filter?.status
      ? entries.filter((e) => e.status === filter.status)
      : entries;
    filtered.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    if (filter?.limit && filter.limit > 0) {
      return filtered.slice(0, filter.limit);
    }
    return filtered;
  }
}

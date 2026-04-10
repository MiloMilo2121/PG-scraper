import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  constructorCalls: 0,
  pragmaCalls: [] as string[],
  execCalls: [] as string[],
}));

vi.mock('better-sqlite3', () => {
  class FakeDatabase {
    constructor() {
      state.constructorCalls += 1;
    }

    pragma(query: string) {
      state.pragmaCalls.push(query);
    }

    exec(query: string) {
      state.execCalls.push(query);
    }

    prepare() {
      return {
        all: () => [],
        get: () => undefined,
        run: () => undefined,
      };
    }

    transaction<T extends (...args: any[]) => any>(fn: T) {
      const wrapped = (...args: Parameters<T>) => fn(...args);
      (wrapped as T & { immediate: () => void }).immediate = () => undefined;
      return wrapped;
    }

    close() {
      return undefined;
    }
  }

  return {
    default: FakeDatabase,
  };
});

describe('DB lazy bootstrap', () => {
  beforeEach(() => {
    state.constructorCalls = 0;
    state.pragmaCalls = [];
    state.execCalls = [];
    vi.resetModules();
  });

  it('does not open SQLite on module import', async () => {
    const dbModule = await import('../../src/enricher/db');

    expect(dbModule).toBeDefined();
    expect(state.constructorCalls).toBe(0);
  });

  it('opens and initializes SQLite only during explicit bootstrap', async () => {
    const dbModule = await import('../../src/enricher/db');

    dbModule.initializeDatabase();

    expect(state.constructorCalls).toBe(1);
    expect(state.pragmaCalls).toContain('journal_mode = WAL');
    expect(state.execCalls.some((query) => query.includes('CREATE TABLE IF NOT EXISTS companies'))).toBe(true);
  });
});

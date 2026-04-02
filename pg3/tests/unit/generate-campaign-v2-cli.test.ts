import { describe, expect, it } from 'vitest';
import { parseCLIArgs } from '../../src/scraper/generate_campaign_v2';

describe('generate_campaign_v2 CLI', () => {
  it('parses query, provinces and limit', () => {
    const parsed = parseCLIArgs([
      '--query=manifattura',
      '--provinces=MI,LO',
      '--limit=100',
    ]);

    expect(parsed.query).toBe('manifattura');
    expect(parsed.provinceCodes).toEqual(['MI', 'LO']);
    expect(parsed.limit).toBe(100);
    expect(parsed.resume).toBe(false);
    expect(parsed.includeImmobiliare).toBe(false);
  });

  it('resolves full province names and keeps resume/checkpoint flags', () => {
    const parsed = parseCLIArgs([
      '--query=metalmeccanica',
      '--provinces=Milano,LO',
      '--resume',
      '--checkpoint-file=/tmp/custom_checkpoint.csv',
    ]);

    expect(parsed.provinceCodes).toEqual(['MI', 'LO']);
    expect(parsed.resume).toBe(true);
    expect(parsed.checkpointFile).toBe('/tmp/custom_checkpoint.csv');
    expect(parsed.limit).toBeUndefined();
    expect(parsed.includeImmobiliare).toBe(false);
  });

  it('enables the optional immobiliare lane only when requested', () => {
    const parsed = parseCLIArgs([
      '--query=Agenzie immobiliari',
      '--provinces=MI',
      '--include-immobiliare',
    ]);

    expect(parsed.includeImmobiliare).toBe(true);
  });

  it('throws on invalid limit values', () => {
    expect(() =>
      parseCLIArgs([
        '--query=manifattura',
        '--provinces=MI',
        '--limit=0',
      ])
    ).toThrow('Invalid --limit value');
  });
});

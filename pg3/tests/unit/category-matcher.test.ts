import { describe, expect, it } from 'vitest';
import { CategoryMatcher } from '../../src/scraper/ai/category_matcher';

describe('CategoryMatcher', () => {
  it('short-circuits exact PG category matches without semantic expansion', async () => {
    await expect(CategoryMatcher.match('Agenzie immobiliari')).resolves.toEqual(['Agenzie immobiliari']);
  });
});

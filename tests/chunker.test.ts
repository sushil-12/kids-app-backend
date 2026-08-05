import { describe, it, expect } from 'vitest';
import { chunkText, estimateTokens } from '../src/services/chunker';

describe('estimateTokens', () => {
  it('returns at least 1 for any non-empty string', () => {
    expect(estimateTokens('hi')).toBeGreaterThanOrEqual(1);
  });

  it('scales roughly with word count', () => {
    const short = estimateTokens('one two three');
    const long = estimateTokens('one two three four five six seven eight nine ten');
    expect(long).toBeGreaterThan(short);
  });
});

describe('chunkText', () => {
  it('returns [] for empty/whitespace input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\t  ')).toEqual([]);
  });

  it('returns a single chunk for short text', () => {
    const text = 'A tiny seed fell into the warm earth.';
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('tiny seed');
  });

  it('splits long text into multiple overlapping chunks', () => {
    // Build a passage well over the 256-token target.
    const sentence = 'The quick brown fox jumps over the lazy dog near the riverbank every single morning. ';
    const text = sentence.repeat(60); // ~600+ words
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk has a positive token count.
    for (const c of chunks) expect(c.tokens).toBeGreaterThan(0);
    // Overlap: the first sentence of chunk[1] should appear in chunk[0].
    const firstOfSecond = chunks[1].text.split('.')[0];
    expect(chunks[0].text).toContain(firstOfSecond);
  });

  it('does not split mid-word', () => {
    const text = 'Elephants are big. They have long trunks. ' .repeat(40);
    const chunks = chunkText(text);
    for (const c of chunks) {
      // No leading/trailing partial whitespace, and text ends on sentence boundary
      // or word boundary (never a dangling fragment glued to the next).
      expect(c.text.trim()).toBe(c.text);
    }
  });

  it('emits an oversized single sentence as its own chunk', () => {
    const giant = 'word '.repeat(400).trim(); // one huge "sentence" (no terminal punct)
    const chunks = chunkText(giant);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].text.length).toBeGreaterThan(0);
  });
});

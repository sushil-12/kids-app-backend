import { describe, it, expect } from 'vitest';
import { buildGroundedPrompt } from '../src/services/grounding';
import type { RetrievedChunk } from '../src/services/rag.types';

function chunk(text: string, score = 0.9, url = 'https://src/x', title = 'Src'): RetrievedChunk {
  return { id: Math.random().toString(36).slice(2), text, sourceUrl: url, sourceTitle: title, score };
}

describe('buildGroundedPrompt', () => {
  it('falls back to an un-grounded prompt when chunks are empty', () => {
    const p = buildGroundedPrompt('write a story', '{title}', []);
    expect(p.sources).toEqual([]);
    expect(p.system).not.toContain('numbered source');
    expect(p.user).toContain('write a story');
    expect(p.user).toContain('{title}');
  });

  it('includes numbered sources and the "use only these sources" instruction', () => {
    const p = buildGroundedPrompt('write a story', '{title}', [
      chunk('Dolosaurs lived long ago.'),
      chunk('A river flows to the sea.'),
    ]);
    expect(p.system).toContain('Use ONLY those sources');
    expect(p.user).toContain('[1]');
    expect(p.user).toContain('[2]');
    expect(p.user).toContain('Dolosaurs lived long ago.');
    expect(p.user).toContain('A river flows to the sea.');
  });

  it('dedupes sources by URL', () => {
    const p = buildGroundedPrompt('intent', '{x}', [
      chunk('one', 0.9, 'https://a', 'A'),
      chunk('two', 0.8, 'https://a', 'A'),
      chunk('three', 0.7, 'https://b', 'B'),
    ]);
    // two unique URLs
    expect(p.sources).toHaveLength(2);
    expect(p.sources.map((s) => s.url).sort()).toEqual(['https://a', 'https://b']);
  });

  it('sorts chunks by score descending and trims to the token budget', () => {
    // Many large chunks; only the highest-scoring should survive the cap.
    const big = 'This is a substantial passage. '.repeat(80);
    const chunks: RetrievedChunk[] = Array.from({ length: 12 }, (_, i) =>
      chunk(big, 1 - i * 0.01, `https://s${i}`, `S${i}`),
    );
    const p = buildGroundedPrompt('intent', '{x}', chunks);
    // Not all 12 sources survive (token cap trims low-score ones).
    expect(p.sources.length).toBeLessThan(12);
    expect(p.sources.length).toBeGreaterThanOrEqual(1);
  });
});

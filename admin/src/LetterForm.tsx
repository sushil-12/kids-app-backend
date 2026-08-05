import {
  LETTER_WORDS_MAX,
  LETTER_WORDS_ON_CARD,
  setText,
  textFor,
  type Lang,
  type LetterSpec,
  type LetterWord,
  type StoryAsset,
} from './types';

// The letter card — the whole of an ABC pack.
//
// A letter is NOT a story with two scenes. A story is a sequence you watch; a
// letter is a record you explore: the glyph, the sound it makes, and a set of
// pictures a child taps in any order. So this form is flat and short, and none
// of the cinematic vocabulary (dramatic job, weather, camera drift) appears —
// asking someone to pick the lighting for the letter A was the bug, not a
// missing field.
//
// Everything here maps 1:1 onto `letterSpec` in src/services/pack.schema.ts.

/** ElevenLabs bills per character, and every line here is one recording. */
function clipState(audio: { en?: string; hi?: string } | undefined, lang: Lang): string {
  return audio?.[lang] ? 'recorded ✓' : 'no recording — the app reads this with its built-in voice';
}

export function LetterForm({
  spec,
  letter,
  lang,
  assets,
  onChange,
}: {
  spec: LetterSpec;
  /** The pack's `letter` field, so the glyph and it can be kept in step. */
  letter: string | undefined;
  lang: Lang;
  assets: StoryAsset[];
  onChange: (next: LetterSpec) => void;
}): JSX.Element {
  const set = (patch: Partial<LetterSpec>): void => onChange({ ...spec, ...patch });

  const imageAssets = assets.filter((a) => a.type === 'image' || a.type === 'gif');

  const setWord = (index: number, patch: Partial<LetterWord>): void => {
    const words = [...spec.words];
    words[index] = { ...words[index], ...patch };
    set({ words });
  };

  function addWord(): void {
    if (spec.words.length >= LETTER_WORDS_MAX) return;
    // Ids are stable keys for narration clips (`word-<id>`), so never reuse a
    // number even after a delete.
    const used = new Set(spec.words.map((w) => w.id));
    let n = spec.words.length + 1;
    while (used.has(`word_${n}`)) n += 1;
    set({ words: [...spec.words, { id: `word_${n}`, text: '', emoji: '❓' }] });
  }

  function removeWord(index: number): void {
    if (spec.words.length <= 1) return;
    const word = spec.words[index];
    if (!window.confirm(`Remove “${textFor(word.text, 'en') || word.id}” from this letter?`)) return;
    set({ words: spec.words.filter((_, i) => i !== index) });
  }

  function moveWord(index: number, delta: number): void {
    const to = index + delta;
    if (to < 0 || to >= spec.words.length) return;
    const words = [...spec.words];
    const [moved] = words.splice(index, 1);
    words.splice(to, 0, moved);
    set({ words });
  }

  const glyphMismatch = Boolean(letter) && spec.glyph.upper !== letter;

  return (
    <div className="card">
      {/* ── The letter itself ── */}
      <div className="section">
        <h3>The letter</h3>
        <div className="fields">
          <div className="field">
            <label>Capital</label>
            <input
              value={spec.glyph.upper}
              onChange={(e) => set({ glyph: { ...spec.glyph, upper: e.target.value } })}
            />
          </div>
          <div className="field">
            <label>Small</label>
            <input
              value={spec.glyph.lower ?? ''}
              placeholder="leave blank for scripts without case"
              onChange={(e) =>
                set({ glyph: { ...spec.glyph, lower: e.target.value || undefined } })
              }
            />
          </div>
          <div className="field">
            <label>Teaching order</label>
            <input
              type="number"
              value={spec.order}
              onChange={(e) => set({ order: Number(e.target.value) })}
            />
          </div>
        </div>
        {glyphMismatch && (
          <div className="small" style={{ marginTop: 6, color: '#b45309' }}>
            This card teaches “{spec.glyph.upper}” but the pack is filed under “{letter}” — set
            them to the same letter on the Settings tab.
          </div>
        )}
        <div className="small muted" style={{ marginTop: 6 }}>
          Teaching order is the path the app offers by default — s-a-t-p-i-n first, not A–Z,
          because those six letters build real three-letter words a child can actually blend on
          day one. A–Z stays available as a toggle.
        </div>
      </div>

      {/* ── Name and sound ── */}
      <div className="section">
        <h3>Its name and its sound</h3>
        <div className="fields">
          <div className="field">
            <label>Letter name ({lang === 'en' ? 'English' : 'Hindi'})</label>
            <input
              placeholder="ay"
              value={textFor(spec.name.text, lang)}
              onChange={(e) =>
                set({ name: { ...spec.name, text: setText(spec.name.text, lang, e.target.value) } })
              }
            />
            <div className="small muted" style={{ marginTop: 4 }}>
              {clipState(spec.name.audio, lang)}
            </div>
          </div>
          <div className="field">
            <label>Sound to say ({lang === 'en' ? 'English' : 'Hindi'})</label>
            <input
              placeholder="aaa"
              value={textFor(spec.phoneme.say, lang)}
              onChange={(e) =>
                set({
                  phoneme: {
                    ...spec.phoneme,
                    say: setText(spec.phoneme.say, lang, e.target.value),
                  },
                })
              }
            />
            <div className="small muted" style={{ marginTop: 4 }}>
              {clipState(spec.phoneme.audio, lang)}
            </div>
          </div>
          <div className="field">
            <label>Written symbol (not spoken)</label>
            <input
              className="mono"
              placeholder="/æ/"
              value={spec.phoneme.ipa ?? ''}
              onChange={(e) =>
                set({ phoneme: { ...spec.phoneme, ipa: e.target.value || undefined } })
              }
            />
          </div>
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          <strong>“Sound to say” is the only thing the voice engine ever gets for the letter
          sound</strong> — so write it the way it should come out, not as the letter. Hold the
          stretchy ones (“sss”, “mmm”, “fff”); clip the sharp ones (“t-t-t”, “p-p-p”). Typing
          just “B” gets you “bee” or “buh”, and a “buh” makes blending into words harder later.
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>Mouth hint ({lang === 'en' ? 'English' : 'Hindi'}) — optional</label>
          <input
            placeholder="Open your mouth wide and say aaa"
            value={textFor(spec.articulation, lang)}
            onChange={(e) => set({ articulation: setText(spec.articulation, lang, e.target.value) })}
          />
        </div>

        <div className="field">
          <label>Letter picture — optional</label>
          <select
            value={spec.mnemonicImage ?? ''}
            onChange={(e) => set({ mnemonicImage: e.target.value || undefined })}
          >
            <option value="">— none —</option>
            {imageAssets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id}
              </option>
            ))}
            {spec.mnemonicImage && !assets.some((a) => a.id === spec.mnemonicImage) && (
              <option value={spec.mnemonicImage}>{spec.mnemonicImage} (missing!)</option>
            )}
          </select>
          <div className="small muted" style={{ marginTop: 4 }}>
            A picture with the letter’s shape drawn <em>inside</em> the object — the A as the
            body of an apple — rather than sitting next to it. Children remember the sound
            noticeably better that way.
          </div>
        </div>
      </div>

      {/* ── Words and pictures ── */}
      <div className="section">
        <div className="row">
          <h3 style={{ margin: 0 }} className="grow">
            Pictures for this letter ({spec.words.length})
          </h3>
          <button onClick={addWord} disabled={spec.words.length >= LETTER_WORDS_MAX}>
            + Add a picture
          </button>
        </div>
        <div className="small muted" style={{ margin: '6px 0 12px' }}>
          The app shows the first {LETTER_WORDS_ON_CARD} on the letter card and puts the rest
          behind <strong>“See more”</strong>, which opens the full grid. So going past{' '}
          {LETTER_WORDS_ON_CARD} isn’t clutter — it’s the second screen. Up to {LETTER_WORDS_MAX}.
        </div>

        {spec.words.map((word, i) => (
          <div key={word.id}>
            {i === LETTER_WORDS_ON_CARD && (
              <div className="small muted" style={{ margin: '16px 0 8px', textAlign: 'center' }}>
                ── below this line lives behind “See more” ──
              </div>
            )}
            <LetterWordRow
              word={word}
              lang={lang}
              assets={assets}
              imageAssets={imageAssets}
              first={i === 0}
              last={i === spec.words.length - 1}
              canRemove={spec.words.length > 1}
              onChange={(patch) => setWord(i, patch)}
              onMove={(delta) => moveWord(i, delta)}
              onRemove={() => removeWord(i)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function LetterWordRow({
  word,
  lang,
  assets,
  imageAssets,
  first,
  last,
  canRemove,
  onChange,
  onMove,
  onRemove,
}: {
  word: LetterWord;
  lang: Lang;
  assets: StoryAsset[];
  imageAssets: StoryAsset[];
  first: boolean;
  last: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<LetterWord>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}): JSX.Element {
  const url = assets.find((a) => a.id === word.image)?.url ?? null;
  const broken = Boolean(word.image) && !url;

  return (
    <div className="moment-item" style={{ alignItems: 'flex-start', cursor: 'default' }}>
      {url ? (
        <img className="thumb" src={url} alt="" loading="lazy" />
      ) : (
        <div className="thumb empty" style={{ fontSize: 24 }}>
          {broken ? '⚠️' : (word.emoji ?? '▨')}
        </div>
      )}

      <div className="grow">
        <div className="fields">
          <div className="field">
            <label>Word ({lang === 'en' ? 'English' : 'Hindi'})</label>
            <input
              placeholder="apple"
              value={textFor(word.text, lang)}
              onChange={(e) => onChange({ text: setText(word.text, lang, e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Emoji</label>
            <input
              value={word.emoji ?? ''}
              onChange={(e) => onChange({ emoji: e.target.value || undefined })}
            />
          </div>
          <div className="field">
            <label>Picture</label>
            <select
              value={word.image ?? ''}
              onChange={(e) => onChange({ image: e.target.value || undefined })}
            >
              <option value="">— emoji only —</option>
              {imageAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id}
                </option>
              ))}
              {broken && <option value={word.image}>{word.image} (missing!)</option>}
            </select>
          </div>
        </div>

        <div className="field">
          <label>Sentence ({lang === 'en' ? 'English' : 'Hindi'}) — optional</label>
          <input
            placeholder="An apple a day keeps the doctor away."
            value={textFor(word.sentence, lang)}
            onChange={(e) => onChange({ sentence: setText(word.sentence, lang, e.target.value) })}
          />
          <div className="small muted" style={{ marginTop: 4 }}>
            Spoken after the word itself, so the child hears the letter inside real speech.
          </div>
        </div>

        <div className="row small muted">
          <span className="mono">word-{word.id}</span>
          <span>· {clipState(word.audio, lang)}</span>
        </div>
      </div>

      <div className="row" style={{ flexDirection: 'column', gap: 4 }}>
        <button className="ghost" disabled={first} onClick={() => onMove(-1)} title="Move up">
          ↑
        </button>
        <button className="ghost" disabled={last} onClick={() => onMove(1)} title="Move down">
          ↓
        </button>
        <button className="danger ghost" disabled={!canRemove} onClick={onRemove} title="Remove">
          ✕
        </button>
      </div>
    </div>
  );
}

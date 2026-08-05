import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { navigate } from './App';
import { MomentForm } from './MomentForm';
import { LetterForm } from './LetterForm';
import { AssetsPanel } from './AssetsPanel';
import { MomentPreview } from './MomentPreview';
import { blankLetterSpec, blankMoment } from './template';
import {
  AGE_BANDS,
  LANGS,
  LETTER_WORDS_ON_CARD,
  MUSIC_TRACKS,
  POEM_TOPICS,
  textFor,
  setText,
  type Clip,
  type Lang,
  type LetterSpec,
  type Moment,
  type Pack,
  type PackKind,
} from './types';

// The editor. Three panes:
//   left    the scene rail — drag to reorder, click to select
//   centre  the selected scene, or the pack's own settings / assets
//   right   a live preview of what a child will see and hear
//
// Everything is edited against one in-memory document and saved whole, because
// the backend validates whole documents: a moment can't be checked for a
// missing picture without the manifest it points into.

// An abc pack opens on `letter` instead: its content IS the letter card, and
// its scenes are an optional extra someone adds later, if ever.
type Tab = 'letter' | 'scene' | 'assets' | 'settings';

export function PackEditor({ id, kind }: { id: string; kind: PackKind }): JSX.Element {
  const [pack, setPack] = useState<Pack | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<Tab>(kind === 'abc' ? 'letter' : 'scene');
  const [lang, setLang] = useState<Lang>('en');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const narrateTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const body = await api.get<Pack>(`/v1/admin/packs/${id}`);
      setPack(body);
      setClips(body.clips ?? []);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // A half-finished scene is real work; don't let a stray back-swipe eat it.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    return () => {
      if (narrateTimer.current) window.clearInterval(narrateTimer.current);
    };
  }, []);

  const update = useCallback((patch: Partial<Pack>) => {
    setPack((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
    setNotice('');
  }, []);

  const updateMoment = useCallback(
    (index: number, next: Moment) => {
      setPack((prev) => {
        if (!prev) return prev;
        const moments = [...prev.moments];
        moments[index] = next;
        return { ...prev, moments };
      });
      setDirty(true);
      setNotice('');
    },
    [],
  );

  const clipsByMoment = useMemo(() => {
    const map = new Map<string, Clip[]>();
    for (const clip of clips) {
      const list = map.get(clip.momentId) ?? [];
      list.push(clip);
      map.set(clip.momentId, list);
    }
    return map;
  }, [clips]);

  if (error && !pack) {
    return (
      <>
        <div className="banner error">{error}</div>
        <button onClick={() => navigate(`#/packs/${kind}`)}>← Back to the library</button>
      </>
    );
  }
  if (!pack) return <div className="empty-state">Loading…</div>;

  const moment: Moment | undefined = pack.moments[selected];
  const isAbc = pack.kind === 'abc';
  // Scenes are the whole of a story and an extra on a letter, so a letter may
  // legitimately have none — and then the rail and the Scene tab just aren't
  // there rather than sitting empty.
  const hasScenes = pack.moments.length > 0;
  const showScenes = !isAbc || hasScenes;

  // ── Actions ──────────────────────────────────────────────────────────────

  async function save(): Promise<Pack | null> {
    if (!pack) return null;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // `clips` and `published` are server-owned; publishing has its own button.
      const { clips: _clips, published: _published, ...document } = pack;
      await api.put(`/v1/admin/packs/${pack.id}`, document);
      const fresh = await api.get<Pack>(`/v1/admin/packs/${pack.id}`);
      setPack(fresh);
      setClips(fresh.clips ?? []);
      setDirty(false);
      setNotice('Saved. Children see this on their next open.');
      return fresh;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function togglePublish(): Promise<void> {
    if (!pack) return;
    // Publishing re-validates on the server against what's STORED, so an unsaved
    // fix wouldn't count. Save first, then publish.
    if (dirty && !(await save())) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/v1/admin/packs/${pack.id}/publish`, { published: !pack.published });
      await load();
      setNotice(pack.published ? 'Unpublished.' : 'Published — this is live for children now.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function narrate(force: boolean): Promise<void> {
    if (!pack) return;
    if (dirty && !(await save())) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/v1/admin/packs/${pack.id}/narrate`, { force });
      setNotice('Recording narration… clips appear here as they finish.');
      // The job is queued, so poll the clip list rather than blocking on it.
      if (narrateTimer.current) window.clearInterval(narrateTimer.current);
      let ticks = 0;
      narrateTimer.current = window.setInterval(() => {
        ticks += 1;
        void (async () => {
          try {
            const body = await api.get<{ items: Clip[]; expected: number }>(
              `/v1/admin/packs/${pack.id}/clips`,
            );
            setClips(body.items);
            if (body.items.length >= body.expected || ticks > 40) {
              if (narrateTimer.current) window.clearInterval(narrateTimer.current);
              narrateTimer.current = null;
              // Clip URLs are written into the moments, so reload the document.
              await load();
              setNotice(
                body.items.length >= body.expected
                  ? 'Narration recorded.'
                  : 'Narration finished with some clips missing — those scenes fall back to the app’s built-in voice.',
              );
            }
          } catch {
            if (narrateTimer.current) window.clearInterval(narrateTimer.current);
            narrateTimer.current = null;
          }
        })();
      }, 3000);
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 503
          ? 'Narration is unavailable — ELEVENLABS_API_KEY is not set on the backend.'
          : err instanceof Error
            ? err.message
            : String(err);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function addMoment(): void {
    if (!pack) return;
    // Ids must be unique and stable — narration clips are keyed by them — so
    // never reuse a number even after a delete.
    const used = new Set(pack.moments.map((m) => m.id));
    let n = pack.moments.length + 1;
    while (used.has(`m${n}`)) n += 1;
    const moments = [...pack.moments, blankMoment(`m${n}`, `Scene ${pack.moments.length + 1}`)];
    update({ moments });
    setSelected(moments.length - 1);
    setTab('scene');
  }

  function duplicateMoment(index: number): void {
    if (!pack) return;
    const used = new Set(pack.moments.map((m) => m.id));
    let n = pack.moments.length + 1;
    while (used.has(`m${n}`)) n += 1;
    const copy: Moment = { ...structuredClone(pack.moments[index]), id: `m${n}` };
    const moments = [...pack.moments];
    moments.splice(index + 1, 0, copy);
    update({ moments });
    setSelected(index + 1);
  }

  function deleteMoment(index: number): void {
    if (!pack) return;
    // A story must keep one scene; a letter may drop to none and go back to
    // being just a card.
    const floor = pack.kind === 'abc' ? 0 : 1;
    if (pack.moments.length <= floor) return;
    const target = pack.moments[index];
    if (!window.confirm(`Delete scene “${textFor(target.title, 'en') || target.id}”?`)) return;
    const moments = pack.moments.filter((_, i) => i !== index);
    update({ moments });
    setSelected(Math.max(0, index - 1));
    if (moments.length === 0) setTab('letter');
  }

  /** Fills in a letter card for an abc pack saved before `letterSpec` existed.
   *  Deliberately a button rather than an on-load fixup: silently mutating a
   *  document the moment you open it would mark it dirty and hide the change. */
  function addLetterCard(): void {
    if (!pack) return;
    update({ letterSpec: blankLetterSpec(pack.letter ?? 'A') });
  }

  function updateLetterSpec(letterSpec: LetterSpec): void {
    update({ letterSpec });
  }

  function reorder(from: number, to: number): void {
    if (!pack || from === to) return;
    const moments = [...pack.moments];
    const [moved] = moments.splice(from, 1);
    moments.splice(to, 0, moved);
    update({ moments });
    setSelected(to);
  }

  const clipFor = (m: Moment | undefined): Clip | undefined =>
    m ? clipsByMoment.get(m.id)?.find((c) => c.lang === lang && c.kind === 'narration') : undefined;

  return (
    <>
      <div className="toolbar-sticky row wrap-items">
        <button className="ghost" onClick={() => navigate(`#/packs/${kind}`)}>
          ← Library
        </button>
        <div className="grow">
          <strong>{textFor(pack.title, 'en') || pack.slug}</strong>{' '}
          <span className="mono muted">{pack.slug}</span>{' '}
          <span className={`badge ${pack.published ? 'live' : 'draft'}`}>
            {pack.published ? 'live' : 'draft'}
          </span>
          {dirty && <span className="badge warn" style={{ marginLeft: 6 }}>unsaved</span>}
        </div>
        <div className="tabs">
          {LANGS.filter((l) => pack.availableLangs.includes(l)).map((l) => (
            <button
              key={l}
              className={`tab ${lang === l ? 'active' : ''}`}
              onClick={() => setLang(l)}
              title="Which language you're editing"
            >
              {l === 'en' ? 'EN' : 'हिन्दी'}
            </button>
          ))}
        </div>
        <button disabled={busy} onClick={() => void narrate(false)} title="Record any missing lines">
          Record voice
        </button>
        <button disabled={busy} onClick={() => void togglePublish()}>
          {pack.published ? 'Unpublish' : 'Publish'}
        </button>
        <button className="primary" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Working…' : 'Save'}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}
      {notice && !error && <div className="banner ok">{notice}</div>}

      <div className="editor">
        {/* ── Scene rail ── */}
        {showScenes ? (
          <div className="card rail">
            <div className="section" style={{ paddingBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Scenes</h3>
              {isAbc && (
                <div className="small muted" style={{ marginTop: 4 }}>
                  The optional “Watch the story!” film behind this letter.
                </div>
              )}
            </div>
            <MomentRail
              moments={pack.moments}
              assetUrl={(assetId) => assetUrlOf(pack, assetId)}
              selected={selected}
              onSelect={(i) => {
                setSelected(i);
                setTab('scene');
              }}
              onReorder={reorder}
            />
            <div className="section row">
              <button className="grow" onClick={addMoment}>
                + Add scene
              </button>
            </div>
          </div>
        ) : (
          <div className="card rail">
            <div className="section">
              <h3 style={{ margin: 0 }}>Story</h3>
              <div className="small muted" style={{ margin: '6px 0 12px' }}>
                This letter is a card — a glyph, a sound and its pictures. It doesn’t need a
                film. Add one only if you want a “Watch the story!” button on it.
              </div>
              <button className="grow" onClick={addMoment}>
                + Add a story
              </button>
            </div>
          </div>
        )}

        {/* ── Centre ── */}
        <div>
          <div className="row" style={{ marginBottom: 12 }}>
            <div className="tabs">
              {isAbc && (
                <button
                  className={`tab ${tab === 'letter' ? 'active' : ''}`}
                  onClick={() => setTab('letter')}
                >
                  Letter
                </button>
              )}
              {showScenes && (
                <button
                  className={`tab ${tab === 'scene' ? 'active' : ''}`}
                  onClick={() => setTab('scene')}
                >
                  Scene
                </button>
              )}
              <button
                className={`tab ${tab === 'assets' ? 'active' : ''}`}
                onClick={() => setTab('assets')}
              >
                Pictures ({pack.assetManifest.length})
              </button>
              <button
                className={`tab ${tab === 'settings' ? 'active' : ''}`}
                onClick={() => setTab('settings')}
              >
                Settings
              </button>
            </div>
            <div className="spacer grow" />
            {tab === 'scene' && moment && (
              <div className="row">
                <button onClick={() => duplicateMoment(selected)}>Duplicate</button>
                <button
                  className="danger ghost"
                  disabled={pack.moments.length <= (isAbc ? 0 : 1)}
                  onClick={() => deleteMoment(selected)}
                >
                  Delete scene
                </button>
              </div>
            )}
          </div>

          {tab === 'letter' &&
            (pack.letterSpec ? (
              <LetterForm
                spec={pack.letterSpec}
                letter={pack.letter}
                lang={lang}
                assets={pack.assetManifest}
                onChange={updateLetterSpec}
              />
            ) : (
              <div className="card">
                <div className="section">
                  <h3>This letter has no card yet</h3>
                  <p className="small muted">
                    A letter pack needs one: the glyph, the sound it makes and the pictures a
                    child taps. Without it the app has nothing to show but a bare letter, and
                    the pack can’t be published.
                  </p>
                  <button className="primary" onClick={addLetterCard}>
                    Set up the letter card
                  </button>
                  <div className="small muted" style={{ marginTop: 8 }}>
                    Starts from the standard phonics content for “{pack.letter ?? 'A'}” — the
                    letter name, its sound and three words with pictures. Edit any of it.
                  </div>
                </div>
              </div>
            ))}
          {tab === 'scene' && moment && (
            <MomentForm
              moment={moment}
              lang={lang}
              assets={pack.assetManifest}
              clip={clipFor(moment)}
              isRhyme={pack.kind === 'poem'}
              onChange={(next) => updateMoment(selected, next)}
            />
          )}
          {tab === 'assets' && (
            <AssetsPanel
              pack={pack}
              onChange={(assetManifest) => update({ assetManifest })}
              onCoverChange={(image) => update({ cover: { ...pack.cover, image } })}
            />
          )}
          {tab === 'settings' && <SettingsPanel pack={pack} lang={lang} onChange={update} />}
        </div>

        {/* ── Preview ── */}
        <div className="preview-pane">
          {tab === 'letter' && pack.letterSpec ? (
            <LetterPreview
              spec={pack.letterSpec}
              lang={lang}
              assetUrl={(assetId) => assetUrlOf(pack, assetId)}
            />
          ) : (
            <MomentPreview
              moment={moment}
              lang={lang}
              imageUrl={assetUrlOf(pack, moment?.visual?.asset ?? moment?.visual?.poster)}
              clip={clipFor(moment)}
            />
          )}
        </div>
      </div>
    </>
  );
}

/** Resolves a manifest id to its pasted URL. Returns null for a missing id —
 *  which is exactly the state the editor needs to surface, not hide. */
export function assetUrlOf(pack: Pack, assetId: string | undefined): string | null {
  if (!assetId) return null;
  const hit = pack.assetManifest.find((a) => a.id === assetId);
  return hit?.url ?? null;
}

// ── Letter preview ─────────────────────────────────────────────────────────

/** The letter card as a child meets it: the glyph, the sound, and the first
 *  few pictures with the "See more" fold drawn where the app puts it. The fold
 *  is the thing worth previewing — from the form alone you can't see which
 *  pictures make the card and which are a tap deeper. */
function LetterPreview({
  spec,
  lang,
  assetUrl,
}: {
  spec: LetterSpec;
  lang: Lang;
  assetUrl: (id: string | undefined) => string | null;
}): JSX.Element {
  const onCard = spec.words.slice(0, LETTER_WORDS_ON_CARD);
  const behind = spec.words.slice(LETTER_WORDS_ON_CARD);

  const tile = (word: LetterSpec['words'][number]): JSX.Element => {
    const url = assetUrl(word.image);
    return (
      <div key={word.id} style={{ textAlign: 'center', width: 84 }}>
        {url ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 16 }}
          />
        ) : (
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 16,
              background: '#f1f5f9',
              display: 'grid',
              placeItems: 'center',
              fontSize: 34,
            }}
          >
            {word.emoji ?? '▨'}
          </div>
        )}
        <div className="small" style={{ marginTop: 4 }}>
          {textFor(word.text, lang) || <span className="muted">(no word)</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="card">
      <div className="section" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 72, lineHeight: 1, fontWeight: 700 }}>
          {spec.glyph.upper}
          {spec.glyph.lower && <span className="muted"> {spec.glyph.lower}</span>}
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>{textFor(spec.name.text, lang) || '—'}</strong>{' '}
          <span className="muted">says</span>{' '}
          <strong>“{textFor(spec.phoneme.say, lang) || '—'}”</strong>
        </div>
        {spec.phoneme.ipa && <div className="small muted mono">{spec.phoneme.ipa}</div>}
        {textFor(spec.articulation, lang) && (
          <div className="small muted" style={{ marginTop: 6 }}>
            {textFor(spec.articulation, lang)}
          </div>
        )}
      </div>

      <div className="section">
        <div className="row" style={{ flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
          {onCard.map(tile)}
        </div>
        {behind.length > 0 && (
          <>
            <div
              className="small"
              style={{
                margin: '14px 0 10px',
                textAlign: 'center',
                padding: '6px 12px',
                borderRadius: 999,
                background: '#f1f5f9',
              }}
            >
              See more ({behind.length}) ▾
            </div>
            <div
              className="row"
              style={{ flexWrap: 'wrap', gap: 12, justifyContent: 'center', opacity: 0.75 }}
            >
              {behind.map(tile)}
            </div>
          </>
        )}
      </div>

      {textFor(spec.words[0]?.sentence, lang) && (
        <div className="section small muted" style={{ textAlign: 'center' }}>
          “{textFor(spec.words[0].sentence, lang)}”
        </div>
      )}
    </div>
  );
}

// ── Scene rail ─────────────────────────────────────────────────────────────

function MomentRail({
  moments,
  assetUrl,
  selected,
  onSelect,
  onReorder,
}: {
  moments: Moment[];
  assetUrl: (id: string | undefined) => string | null;
  selected: number;
  onSelect: (index: number) => void;
  onReorder: (from: number, to: number) => void;
}): JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  return (
    <div>
      {moments.map((moment, index) => {
        const url = assetUrl(moment.visual?.asset);
        const broken = Boolean(moment.visual?.asset) && !url;
        return (
          <div
            key={moment.id}
            className={[
              'moment-item',
              index === selected ? 'active' : '',
              over === index && dragging !== null && dragging !== index ? 'drag-over' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            draggable
            onClick={() => onSelect(index)}
            onDragStart={() => setDragging(index)}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(index);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null) onReorder(dragging, index);
              setDragging(null);
              setOver(null);
            }}
          >
            <div className="idx">{index + 1}</div>
            {url ? (
              <img className="thumb" src={url} alt="" loading="lazy" />
            ) : (
              <div className="thumb empty">{broken ? '⚠️' : '▨'}</div>
            )}
            <div className="meta">
              <div className="name">{textFor(moment.title, 'en') || moment.id}</div>
              <div className="small muted">{moment.job ?? 'establish'}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Pack settings ──────────────────────────────────────────────────────────

function SettingsPanel({
  pack,
  lang,
  onChange,
}: {
  pack: Pack;
  lang: Lang;
  onChange: (patch: Partial<Pack>) => void;
}): JSX.Element {
  return (
    <div className="card">
      <div className="section">
        <h3>Identity</h3>
        <div className="fields">
          <div className="field">
            <label>Slug</label>
            <input
              className="mono"
              value={pack.slug}
              onChange={(e) => onChange({ slug: e.target.value })}
            />
            <div className="small muted" style={{ marginTop: 4 }}>
              The app addresses this pack by its slug — changing it breaks any link to it.
            </div>
          </div>
          <div className="field">
            <label>Cover emoji</label>
            <input
              value={pack.cover.emoji}
              onChange={(e) => onChange({ cover: { ...pack.cover, emoji: e.target.value } })}
            />
          </div>
          <div className="field">
            <label>Category</label>
            <input value={pack.category} onChange={(e) => onChange({ category: e.target.value })} />
          </div>
        </div>

        <div className="field">
          <label>Title ({lang === 'en' ? 'English' : 'Hindi'})</label>
          <input
            value={textFor(pack.title, lang)}
            onChange={(e) => onChange({ title: setText(pack.title, lang, e.target.value) })}
          />
        </div>
        <div className="field">
          <label>Moral / summary ({lang === 'en' ? 'English' : 'Hindi'})</label>
          <input
            value={textFor(pack.moral, lang)}
            onChange={(e) => onChange({ moral: setText(pack.moral, lang, e.target.value) })}
          />
        </div>
      </div>

      <div className="section">
        <h3>Audience</h3>
        <div className="fields">
          <div className="field">
            <label>Age band</label>
            <select value={pack.ageBand} onChange={(e) => onChange({ ageBand: e.target.value as 'junior' })}>
              {AGE_BANDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          {pack.kind === 'poem' && (
            <div className="field">
              <label>Topic</label>
              <select value={pack.topic ?? ''} onChange={(e) => onChange({ topic: e.target.value })}>
                {POEM_TOPICS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}
          {pack.kind === 'abc' && (
            <div className="field">
              <label>Letter</label>
              <select
                value={pack.letter ?? 'A'}
                onChange={(e) => onChange({ letter: e.target.value })}
              >
                {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>Surfaces on (blank = always)</label>
            <input
              placeholder="YYYY-MM-DD"
              value={pack.date ?? ''}
              onChange={(e) => onChange({ date: e.target.value.trim() || null })}
            />
          </div>
        </div>

        {/* A rhyme is written in ONE language: rhyme, metre and wordplay do
            not survive translation, so मछली जल की रानी है is its own poem, not
            the Hindi side of an English one. Offering checkboxes here would
            invite an authoring mistake the validator then refuses — so this is
            a choice, not a set. Everything else stays multi-select. */}
        <div className="field">
          <label>{pack.kind === 'poem' ? 'Language' : 'Languages'}</label>
          <div className="row">
            {LANGS.map((l) => {
              const on = pack.availableLangs.includes(l);
              return (
                <label key={l} className="row small" style={{ margin: 0, gap: 6 }}>
                  <input
                    type={pack.kind === 'poem' ? 'radio' : 'checkbox'}
                    name={pack.kind === 'poem' ? 'pack-lang' : undefined}
                    style={{ width: 'auto' }}
                    checked={on}
                    onChange={(e) =>
                      onChange({
                        availableLangs:
                          pack.kind === 'poem'
                            ? ([l] as Lang[])
                            : e.target.checked
                              ? ([...pack.availableLangs, l] as Lang[])
                              : (pack.availableLangs.filter((x) => x !== l) as Lang[]),
                      })
                    }
                  />
                  {l === 'en' ? 'English' : 'हिन्दी'}
                </label>
              );
            })}
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            {pack.kind === 'poem'
              ? 'To offer this rhyme in the other language, publish a different rhyme written in it — not a translation of this one.'
              : 'Turning on a language means every scene needs narration in it — publishing is blocked until they do.'}
          </div>
        </div>

        {pack.kind === 'poem' && (
          <div className="field">
            <label className="row small" style={{ margin: 0, gap: 6 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={pack.audio.singAlong ?? false}
                onChange={(e) =>
                  onChange({ audio: { ...pack.audio, singAlong: e.target.checked } })
                }
              />
              Sing-along player
            </label>
            <div className="small muted" style={{ marginTop: 6 }}>
              On: the app shows the verse with the current word highlighted and a
              big “again” button. Off: it plays like a story, narrated over the
              pictures.
            </div>
          </div>
        )}
      </div>

      <div className="section">
        <h3>Sound</h3>
        <div className="fields">
          <div className="field">
            <label>Music bed</label>
            <select
              value={pack.audio.music?.track ?? 'calm'}
              onChange={(e) =>
                onChange({
                  audio: { ...pack.audio, music: { ...pack.audio.music, track: e.target.value } },
                })
              }
            >
              {MUSIC_TRACKS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Ambience</label>
            <input
              placeholder="e.g. dry_summer"
              value={pack.audio.ambience?.bed ?? ''}
              onChange={(e) =>
                onChange({
                  audio: {
                    ...pack.audio,
                    ambience: e.target.value.trim()
                      ? { ...pack.audio.ambience, bed: e.target.value.trim() }
                      : undefined,
                  },
                })
              }
            />
          </div>
          <div className="field">
            <label>Estimated length (seconds)</label>
            <input
              type="number"
              value={pack.estimatedDuration}
              onChange={(e) => onChange({ estimatedDuration: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>

      <div className="section">
        <h3>Reward</h3>
        <div className="fields">
          <div className="field">
            <label>Stars</label>
            <input
              type="number"
              value={pack.reward.stars ?? 10}
              onChange={(e) => onChange({ reward: { ...pack.reward, stars: Number(e.target.value) } })}
            />
          </div>
          <div className="field">
            <label>Coins</label>
            <input
              type="number"
              value={pack.reward.coins ?? 5}
              onChange={(e) => onChange({ reward: { ...pack.reward, coins: Number(e.target.value) } })}
            />
          </div>
          <div className="field">
            <label>Sticker id</label>
            <input
              value={pack.reward.badgeStickerId ?? 'star'}
              onChange={(e) =>
                onChange({ reward: { ...pack.reward, badgeStickerId: e.target.value } })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

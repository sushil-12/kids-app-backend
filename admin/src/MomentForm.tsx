import {
  CUE_TYPES,
  LIGHTING,
  MOMENT_JOBS,
  MOODS,
  SFX_NAMES,
  TIMES_OF_DAY,
  VISUAL_KINDS,
  WEATHER,
  setText,
  textFor,
  type Clip,
  type Cue,
  type Lang,
  type Moment,
  type StoryAsset,
} from './types';

// One scene. The picture, the words, the timing.
//
// The picture field is a dropdown of manifest ids rather than a URL box: an
// image is referenced by id so it can be reused across scenes and swapped once.
// Pasting URLs happens on the Pictures tab.

/** ElevenLabs bills per character; showing the count makes the cost of a
 *  rewrite visible before someone clicks "Record voice" fifty times. */
function costHint(text: string): string {
  if (!text) return 'no narration yet';
  return `${text.length} characters`;
}

export function MomentForm({
  moment,
  lang,
  assets,
  clip,
  isRhyme = false,
  onChange,
}: {
  moment: Moment;
  lang: Lang;
  assets: StoryAsset[];
  clip?: Clip;
  /** Rhymes get a verse editor and a read-only spoken line; see below. */
  isRhyme?: boolean;
  onChange: (next: Moment) => void;
}): JSX.Element {
  const set = (patch: Partial<Moment>): void => onChange({ ...moment, ...patch });

  // Rhyme verse is monolingual, so the lines are plain strings.
  const verseLines: string[] = (moment.verse ?? []).map((l) =>
    typeof l === 'string' ? l : (l.en ?? ''),
  );

  const imageAssets = assets.filter(
    (a) => a.type === 'image' || a.type === 'gif' || a.type === 'video',
  );
  const brokenAsset =
    Boolean(moment.visual?.asset) && !assets.some((a) => a.id === moment.visual?.asset);

  return (
    <div className="card">
      {/* ── The picture ── */}
      <div className="section">
        <h3>Picture</h3>
        <div className="fields">
          <div className="field">
            <label>Shown as</label>
            <select
              value={moment.visual?.primary ?? 'vector'}
              onChange={(e) =>
                set({
                  visual: { ...moment.visual, primary: e.target.value as 'image' },
                })
              }
            >
              {VISUAL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k === 'vector' ? 'vector (drawn by the app)' : k}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Image</label>
            <select
              value={moment.visual?.asset ?? ''}
              onChange={(e) =>
                set({
                  visual: { ...moment.visual, primary: moment.visual?.primary ?? 'image', asset: e.target.value || undefined },
                })
              }
            >
              <option value="">— none —</option>
              {imageAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id}
                </option>
              ))}
              {/* Keep a dangling reference visible rather than silently
                  resetting the field to "none" on load. */}
              {brokenAsset && (
                <option value={moment.visual?.asset}>{moment.visual?.asset} (missing!)</option>
              )}
            </select>
          </div>
          {moment.visual?.primary === 'video' && (
            <div className="field">
              <label>Poster still</label>
              <select
                value={moment.visual?.poster ?? ''}
                onChange={(e) =>
                  set({ visual: { ...moment.visual!, poster: e.target.value || undefined } })
                }
              >
                <option value="">— none —</option>
                {imageAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {brokenAsset && (
          <div className="banner error" style={{ marginBottom: 0 }}>
            “{moment.visual?.asset}” is not in this pack’s pictures. Add it on the Pictures tab or
            pick another — saving is blocked until then.
          </div>
        )}
        {moment.visual?.primary === 'vector' && (
          <div className="small muted">
            The app draws this scene itself from the vector fallback. It always works, even with no
            network — pick an image to make it richer.
          </div>
        )}
      </div>

      {/* ── The verse (rhymes only) ── */}
      {isRhyme && (
        <div className="section">
          <h3>Verse</h3>
          <div className="field">
            <label>The lines, as they should appear on screen — one per line</label>
            <textarea
              rows={Math.max(3, verseLines.length + 1)}
              value={verseLines.join('\n')}
              onChange={(e) => {
                const lines = e.target.value
                  .split('\n')
                  .map((l) => l.trimEnd())
                  .filter((l) => l.trim().length > 0);
                // The spoken line is derived, never typed: it is what gets
                // recorded and what the word timings are measured against, so
                // letting the two drift apart would put the sing-along
                // highlight on the wrong word.
                set({
                  verse: lines,
                  narration: { ...moment.narration, text: lines.join(' ') },
                });
              }}
            />
            <div className="small muted" style={{ marginTop: 6 }}>
              {verseLines.length === 0
                ? 'A rhyme needs its lines here — saving is blocked without them.'
                : `${verseLines.length} line${verseLines.length === 1 ? '' : 's'} · spoken as one line, ${
                    verseLines.join(' ').length
                  } characters`}
            </div>
          </div>
        </div>
      )}

      {/* ── The words ── */}
      <div className="section">
        <h3>{isRhyme ? 'Spoken line' : 'Narration'}</h3>
        <div className="field">
          <label>Scene title ({lang === 'en' ? 'English' : 'Hindi'})</label>
          <input
            value={textFor(moment.title, lang)}
            onChange={(e) => set({ title: setText(moment.title, lang, e.target.value) })}
          />
        </div>

        {isRhyme ? (
          // A rhyme is monolingual and its spoken line is derived from the
          // verse above, so this is a read-back, not a second place to type.
          <div className="field">
            <label>
              What gets recorded — {costHint(textFor(moment.narration.text, lang))}
            </label>
            <textarea readOnly value={textFor(moment.narration.text, lang)} />
            <div className="small muted" style={{ marginTop: 6 }}>
              Edit the verse above; this follows it.
            </div>
          </div>
        ) : (
        <div className="bilingual">
          <div className="field">
            <label>English — {costHint(textFor(moment.narration.text, 'en'))}</label>
            <textarea
              value={textFor(moment.narration.text, 'en')}
              onChange={(e) =>
                set({
                  narration: {
                    ...moment.narration,
                    text: setText(moment.narration.text, 'en', e.target.value),
                  },
                })
              }
            />
          </div>
          <div className="field">
            <label>हिन्दी — {costHint(textFor(moment.narration.text, 'hi'))}</label>
            <textarea
              value={textFor(moment.narration.text, 'hi')}
              onChange={(e) =>
                set({
                  narration: {
                    ...moment.narration,
                    text: setText(moment.narration.text, 'hi', e.target.value),
                  },
                })
              }
            />
          </div>
        </div>
        )}

        <div className="small muted">
          {clip ? (
            <>Recorded voice-over exists for {lang === 'en' ? 'English' : 'Hindi'}. Editing this
            text makes it stale — press “Record voice” again to re-record just the changed lines.</>
          ) : (
            <>No recorded voice yet — the app reads this aloud with its built-in voice.</>
          )}
        </div>
      </div>

      {/* ── Timing & mood ── */}
      <div className="section">
        <h3>Pacing</h3>
        <div className="fields">
          <div className="field">
            <label>Dramatic job</label>
            <select
              value={moment.job ?? 'establish'}
              onChange={(e) => set({ job: e.target.value as 'establish' })}
            >
              {MOMENT_JOBS.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Minimum seconds on screen</label>
            <input
              type="number"
              min={1}
              max={120}
              value={moment.minDuration ?? 8}
              onChange={(e) => set({ minDuration: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Mood</label>
            <select value={moment.mood ?? 'calm'} onChange={(e) => set({ mood: e.target.value as 'calm' })}>
              {MOODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Time of day</label>
            <select
              value={moment.timeOfDay ?? 'morning'}
              onChange={(e) => set({ timeOfDay: e.target.value as 'morning' })}
            >
              {TIMES_OF_DAY.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Weather</label>
            <select
              value={moment.weather ?? 'clear'}
              onChange={(e) => set({ weather: e.target.value as 'clear' })}
            >
              {WEATHER.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Lighting</label>
            <select
              value={moment.lighting ?? 'warm'}
              onChange={(e) => set({ lighting: e.target.value as 'warm' })}
            >
              {LIGHTING.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="small muted">
          The scene stays up for at least this long, or until the narration finishes — whichever is
          longer. A child is never rushed.
        </div>
      </div>

      {/* ── Camera ── */}
      <div className="section">
        <h3>Camera drift</h3>
        <div className="fields">
          <div className="field">
            <label>Start zoom</label>
            <input
              type="number"
              step={0.05}
              min={0.5}
              max={4}
              value={moment.camera?.from?.zoom ?? 1}
              onChange={(e) =>
                set({
                  camera: {
                    ...moment.camera,
                    from: { ...moment.camera?.from, zoom: Number(e.target.value) },
                  },
                })
              }
            />
          </div>
          <div className="field">
            <label>End zoom</label>
            <input
              type="number"
              step={0.05}
              min={0.5}
              max={4}
              value={moment.camera?.to?.zoom ?? 1}
              onChange={(e) =>
                set({
                  camera: {
                    ...moment.camera,
                    to: { ...moment.camera?.to, zoom: Number(e.target.value) },
                  },
                })
              }
            />
          </div>
          <div className="field">
            <label>Move over (seconds)</label>
            <input
              type="number"
              step={0.5}
              min={0}
              max={60}
              value={moment.camera?.duration ?? 6}
              onChange={(e) => set({ camera: { ...moment.camera, duration: Number(e.target.value) } })}
            />
          </div>
        </div>
      </div>

      {/* ── Cues ── */}
      <div className="section">
        <h3>Timed beats</h3>
        <CueTable
          cues={moment.cues ?? []}
          onChange={(cues) => set({ cues })}
          stagedIds={stagedIdsOf(moment)}
        />
      </div>

      {/* ── Soft gate ── */}
      <div className="section">
        <h3>Let the child help</h3>
        <label className="row small" style={{ margin: 0, gap: 6 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={moment.softGate?.mode === 'soft_gate'}
            onChange={(e) =>
              set({
                softGate: e.target.checked
                  ? {
                      mode: 'soft_gate',
                      prompt: moment.softGate?.prompt ?? 'Tap to help!',
                      successThreshold: moment.softGate?.successThreshold ?? 5,
                      timeoutAutoPlay: moment.softGate?.timeoutAutoPlay ?? 10,
                      autoStepSeconds: moment.softGate?.autoStepSeconds ?? 2.2,
                      reactionSound: moment.softGate?.reactionSound ?? 'plop',
                    }
                  : undefined,
              })
            }
          />
          This scene waits for the child to join in
        </label>

        {moment.softGate?.mode === 'soft_gate' && (
          <>
            <div className="bilingual" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Prompt — English</label>
                <input
                  value={textFor(moment.softGate.prompt, 'en')}
                  onChange={(e) =>
                    set({
                      softGate: {
                        ...moment.softGate!,
                        prompt: setText(moment.softGate!.prompt, 'en', e.target.value),
                      },
                    })
                  }
                />
              </div>
              <div className="field">
                <label>Prompt — हिन्दी</label>
                <input
                  value={textFor(moment.softGate.prompt, 'hi')}
                  onChange={(e) =>
                    set({
                      softGate: {
                        ...moment.softGate!,
                        prompt: setText(moment.softGate!.prompt, 'hi', e.target.value),
                      },
                    })
                  }
                />
              </div>
            </div>
            <div className="fields">
              <div className="field">
                <label>Taps to finish</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={moment.softGate.successThreshold ?? 5}
                  onChange={(e) =>
                    set({
                      softGate: { ...moment.softGate!, successThreshold: Number(e.target.value) },
                    })
                  }
                />
              </div>
              <div className="field">
                <label>Helps out after (seconds)</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={moment.softGate.timeoutAutoPlay ?? 10}
                  onChange={(e) =>
                    set({
                      softGate: { ...moment.softGate!, timeoutAutoPlay: Number(e.target.value) },
                    })
                  }
                />
              </div>
              <div className="field">
                <label>Reaction sound</label>
                <select
                  value={moment.softGate.reactionSound ?? 'plop'}
                  onChange={(e) =>
                    set({ softGate: { ...moment.softGate!, reactionSound: e.target.value } })
                  }
                >
                  {SFX_NAMES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="small muted">
              There is no way to fail: if the child doesn’t tap, the story finishes the action
              itself and moves on.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Ids a cue may target: whatever this scene stages, plus the whole canvas.
 *  Mirrors the same check in the backend validator so the dropdown can only
 *  produce values that will save. */
function stagedIdsOf(moment: Moment): string[] {
  const ids = new Set<string>(['stage']);
  for (const cast of moment.vectorFallback?.cast ?? []) ids.add(cast.id);
  for (const layer of moment.vectorFallback?.layers ?? []) {
    for (const prop of layer.props ?? []) ids.add(prop.id);
  }
  return [...ids];
}

function CueTable({
  cues,
  onChange,
  stagedIds,
}: {
  cues: Cue[];
  onChange: (cues: Cue[]) => void;
  stagedIds: string[];
}): JSX.Element {
  const set = (index: number, patch: Partial<Cue>): void => {
    const next = [...cues];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  return (
    <>
      {cues.length === 0 && (
        <p className="small muted" style={{ marginTop: 0 }}>
          No beats yet. Add one to fire a sound or make a character move partway through the scene.
        </p>
      )}
      {cues.map((cue, index) => (
        <div className="cue-row" key={index}>
          <select
            value={cue.type}
            onChange={(e) => set(index, { type: e.target.value as Cue['type'] })}
          >
            {CUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            type="number"
            step={0.1}
            min={0}
            value={cue.t}
            title="Seconds into the scene"
            onChange={(e) => set(index, { t: Number(e.target.value) })}
          />
          {cue.type === 'sfx' ? (
            <select value={cue.sound ?? 'chime'} onChange={(e) => set(index, { sound: e.target.value })}>
              {SFX_NAMES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          ) : cue.type === 'hold' ? (
            <input
              type="number"
              step={0.1}
              value={cue.duration ?? 1}
              title="Seconds of silence"
              onChange={(e) => set(index, { duration: Number(e.target.value) })}
            />
          ) : (
            <select
              value={cue.target ?? ''}
              onChange={(e) => set(index, { target: e.target.value || undefined })}
            >
              <option value="">— target —</option>
              {stagedIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          )}
          {cue.type === 'character' ? (
            <input
              value={cue.action ?? 'idle'}
              placeholder="hop, fly, celebrate…"
              onChange={(e) => set(index, { action: e.target.value })}
            />
          ) : (
            <div />
          )}
          <button
            className="danger ghost"
            onClick={() => onChange(cues.filter((_, i) => i !== index))}
            title="Remove this beat"
          >
            ✕
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...cues, { type: 'sfx', t: 1, sound: 'chime', volume: 0.5 }])}>
        + Add beat
      </button>
    </>
  );
}

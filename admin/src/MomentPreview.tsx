import { useEffect, useRef, useState } from 'react';
import { textFor, type Clip, type Lang, type Moment, type WordMark } from './types';

// What a child will see and hear.
//
// Not a pixel-perfect emulator — it's the two things you can't check from a
// form: whether the picture actually loads at the framing you chose, and
// whether the recorded voice sounds right against it. The zoom animation
// replays the moment's camera drift on a loop so a push-in that crops someone's
// head out is obvious here rather than on a tablet.

/** The word timings for one language. Bilingual packs store a map per
 *  language; a monolingual rhyme stores a bare list. */
function marksFor(moment: Moment, lang: Lang): WordMark[] {
  const raw = moment.narration.marks;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return raw[lang] ?? raw.en ?? [];
  return [];
}

/** Index of the word being spoken at [seconds], or -1 before the first.
 *  Mirrors `activeWordIndex` in the app's rhyme_lyrics.dart. */
function activeWordIndex(marks: WordMark[], seconds: number): number {
  let active = -1;
  for (let i = 0; i < marks.length; i++) {
    if (marks[i].t > seconds) break;
    active = i;
  }
  return active;
}

/** How many words precede line [index] — the offset into the flat mark list. */
function wordsBefore(verse: string[], index: number): number {
  let total = 0;
  for (let i = 0; i < index; i++) total += verse[i].split(/\s+/).length;
  return total;
}

export function MomentPreview({
  moment,
  lang,
  imageUrl,
  clip,
}: {
  moment: Moment | undefined;
  lang: Lang;
  imageUrl: string | null;
  clip?: Clip;
}): JSX.Element {
  const [phase, setPhase] = useState<'from' | 'to'>('from');
  const [failed, setFailed] = useState(false);
  // Playhead of the recorded clip, for the sing-along highlight below.
  const [position, setPosition] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);

  const fromZoom = moment?.camera?.from?.zoom ?? 1;
  const toZoom = moment?.camera?.to?.zoom ?? 1;
  const duration = moment?.camera?.duration ?? 6;

  useEffect(() => {
    setPhase('from');
    setFailed(false);
    if (!moment) return;
    const timer = window.setInterval(
      () => setPhase((p) => (p === 'from' ? 'to' : 'from')),
      Math.max(1500, duration * 1000),
    );
    return () => window.clearInterval(timer);
  }, [moment, duration]);

  if (!moment) {
    return (
      <div className="card">
        <div className="empty-state">Pick a scene to preview it.</div>
      </div>
    );
  }

  const narration = textFor(moment.narration.text, lang);
  const zoom = phase === 'from' ? fromZoom : toZoom;

  const verse: string[] = (moment.verse ?? []).map((l) =>
    typeof l === 'string' ? l : (l.en ?? ''),
  );
  const marks = marksFor(moment, lang);
  const activeWord = activeWordIndex(marks, position);

  return (
    <div className="card">
      <div className="section" style={{ padding: 12 }}>
        <div className="preview-frame">
          {imageUrl && !failed ? (
            <img
              src={imageUrl}
              alt=""
              onError={() => setFailed(true)}
              style={{
                transform: `scale(${zoom})`,
                transitionDuration: `${Math.max(1.5, duration)}s`,
              }}
            />
          ) : (
            <div className="empty-note">
              {failed
                ? 'That image URL did not load. Check it on the Pictures tab — a child would see the app’s drawn fallback instead.'
                : 'No picture — the app draws this scene itself.'}
            </div>
          )}
        </div>
        {verse.length > 0 ? (
          // The verse as the child sees it, with the word the clip is on lit
          // up. Play the audio below and watch it track: timings that lag or
          // run ahead are obvious here and invisible in a form.
          <div className="preview-caption">
            {verse.map((line, i) => (
              <div key={i}>
                {wordsBefore(verse, i) >= 0 &&
                  line.split(/\s+/).map((word, w) => {
                    const flat = wordsBefore(verse, i) + w;
                    return (
                      <span
                        key={w}
                        style={{
                          color: flat === activeWord ? '#8C73F2' : undefined,
                          fontWeight: flat === activeWord ? 700 : undefined,
                        }}
                      >
                        {word}{' '}
                      </span>
                    );
                  })}
              </div>
            ))}
          </div>
        ) : (
          <div className="preview-caption">
            {narration || <span className="muted">No narration in this language yet.</span>}
          </div>
        )}
      </div>

      <div className="section">
        <h3>Voice</h3>
        {clip ? (
          <>
            {/* Keyed by clip id so re-recording swaps the audio element rather
                than leaving the browser playing the previous take. */}
            <audio
              key={clip.id}
              ref={audio}
              controls
              preload="none"
              src={clip.url}
              onTimeUpdate={() => setPosition(audio.current?.currentTime ?? 0)}
              onEnded={() => setPosition(0)}
            />
            <div className="small muted" style={{ marginTop: 6 }}>
              {(clip.bytes / 1024).toFixed(0)} KB · recorded{' '}
              {new Date(clip.createdAt).toLocaleDateString()}
              {marks.length > 0 ? (
                <> · {marks.length} word timings</>
              ) : (
                <> · no word timings — the app highlights whole lines. Re-record
                to generate them.</>
              )}
            </div>
          </>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            No recorded clip for {lang === 'en' ? 'English' : 'Hindi'}. The app reads this scene
            aloud with its built-in voice — press “Record voice” for a narrated take.
          </p>
        )}
      </div>

      <div className="section small muted">
        Runs for at least {moment.minDuration ?? 8}s · {moment.mood ?? 'calm'} ·{' '}
        {moment.timeOfDay ?? 'morning'} · zoom {fromZoom}→{toZoom}
      </div>
    </div>
  );
}

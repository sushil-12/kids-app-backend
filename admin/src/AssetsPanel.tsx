import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { humanSize, loadMediaConfig, uploadImage } from './upload';
import {
  ASSET_TYPES,
  type GifResult,
  type MediaAsset,
  type MediaConfig,
  type Pack,
  type StoryAsset,
} from './types';

// The pictures behind a pack.
//
// Two ways in, and both end at the same place — a URL in the manifest:
//   • Upload a file. It goes straight to S3 and joins a reusable library, so
//     the same illustration can back several packs without re-uploading.
//   • Paste a URL. Still fully supported: artwork hosted elsewhere is a valid
//     answer, and it's the only option when S3 isn't configured.
//
// Scenes point at an asset by id, so renaming an id would orphan every scene
// using it; the id field renames the references too.

interface Props {
  pack: Pack;
  onChange: (assets: StoryAsset[]) => void;
  onCoverChange: (imageId: string | undefined) => void;
}

/** A short, stable id from a file name — "crow-drinks.png" → "img_crow_drinks",
 *  so the manifest reads like something a person wrote. */
function suggestId(filename: string, taken: Set<string>): string {
  const base =
    filename
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'image';
  let id = `img_${base}`;
  let n = 2;
  while (taken.has(id)) id = `img_${base}_${n++}`;
  return id;
}

export function AssetsPanel({ pack, onChange, onCoverChange }: Props): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [media, setMedia] = useState<MediaConfig | null>(null);
  const [library, setLibrary] = useState<MediaAsset[] | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showGifs, setShowGifs] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    void loadMediaConfig().then(setMedia).catch(() => setMedia(null));
  }, []);

  /** assetId → the scene numbers that use it. Drives the "used by" hint and
   *  the unused/missing badges. */
  const usage = useMemo(() => {
    const map = new Map<string, number[]>();
    pack.moments.forEach((moment, index) => {
      for (const id of [moment.visual?.asset, moment.visual?.poster, moment.visual?.overlayAnimation]) {
        if (!id) continue;
        map.set(id, [...(map.get(id) ?? []), index + 1]);
      }
    });
    return map;
  }, [pack.moments]);

  /** Ids scenes reference that no asset provides — the failure that reaches a
   *  child as a blank screen, so it gets its own callout. */
  const dangling = useMemo(() => {
    const known = new Set(pack.assetManifest.map((a) => a.id));
    const missing = new Set<string>();
    for (const id of usage.keys()) if (!known.has(id)) missing.add(id);
    if (pack.cover.image && !known.has(pack.cover.image)) missing.add(pack.cover.image);
    return [...missing];
  }, [pack.assetManifest, pack.cover.image, usage]);

  function update(index: number, patch: Partial<StoryAsset>): void {
    const next = [...pack.assetManifest];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  function rename(index: number, nextId: string): void {
    const previous = pack.assetManifest[index].id;
    update(index, { id: nextId });
    // Renaming an id without following the references would orphan every scene
    // that used it — which is precisely the mistake this panel exists to stop.
    if (previous && previous !== nextId && pack.cover.image === previous) {
      onCoverChange(nextId);
    }
  }

  function addAsset(id: string, url: string, patch: Partial<StoryAsset> = {}): void {
    onChange([
      ...pack.assetManifest,
      { id, type: 'image', url, bytes: 0, v: 1, ...patch },
    ]);
  }

  function add(): void {
    const id = newId.trim();
    const url = newUrl.trim();
    if (!id || !url) return;
    addAsset(id, url);
    setNewId('');
    setNewUrl('');
    setAdding(false);
  }

  async function handleFiles(files: FileList | File[]): Promise<void> {
    setError('');
    const taken = new Set(pack.assetManifest.map((a) => a.id));
    const accepted: StoryAsset[] = [];

    for (const file of Array.from(files)) {
      if (media && !media.acceptedTypes.includes(file.type)) {
        setError(`${file.name} isn't an image type we can host (${file.type || 'unknown'}).`);
        continue;
      }
      try {
        setUploading({ name: file.name, pct: 0 });
        const asset = await uploadImage(file, {
          folder: pack.slug,
          onProgress: (f) => setUploading({ name: file.name, pct: Math.round(f * 100) }),
        });
        const id = suggestId(file.name, taken);
        taken.add(id);
        accepted.push({ id, type: 'image', url: asset.url, bytes: asset.byteLength, v: 1 });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    setUploading(null);
    if (accepted.length > 0) {
      onChange([...pack.assetManifest, ...accepted]);
      setLibrary(null); // stale — refetched next time the library opens
    }
  }

  async function openLibrary(): Promise<void> {
    setShowLibrary(true);
    if (library) return;
    try {
      const body = await api.get<{ items: MediaAsset[] }>('/v1/admin/media?limit=100');
      setLibrary(body.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLibrary([]);
    }
  }

  const uploadsOn = media?.uploadsEnabled ?? false;
  const gifSearchOn = media?.gifSearchEnabled ?? false;

  return (
    <div className="card">
      <div className="section">
        <h3>Cover</h3>
        <div className="row">
          <select
            value={pack.cover.image ?? ''}
            onChange={(e) => onCoverChange(e.target.value || undefined)}
            style={{ maxWidth: 260 }}
          >
            <option value="">— emoji only ({pack.cover.emoji}) —</option>
            {pack.assetManifest
              .filter((a) => a.type === 'image')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id}
                </option>
              ))}
          </select>
          <div className="small muted">Shown on the shelf tile in the app.</div>
        </div>
      </div>

      {error && (
        <div className="section">
          <div className="banner error" style={{ marginBottom: 0 }}>
            {error}
          </div>
        </div>
      )}

      {dangling.length > 0 && (
        <div className="section">
          <div className="banner error" style={{ marginBottom: 0 }}>
            {dangling.length === 1 ? 'A scene points' : 'Scenes point'} at{' '}
            {dangling.map((id) => `“${id}”`).join(', ')}, which {dangling.length === 1 ? 'is' : 'are'}{' '}
            not listed below. Add {dangling.length === 1 ? 'it' : 'them'} here, or change the scene —
            saving is blocked until then.
            <div className="row" style={{ marginTop: 10 }}>
              {dangling.map((id) => (
                <button key={id} onClick={() => addAsset(id, '')}>
                  Add “{id}”
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Upload ── */}
      <div className="section">
        <h3>Add pictures</h3>
        {uploadsOn ? (
          <div
            className={`dropzone ${dragging ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInput.current?.click()}
          >
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={media?.acceptedTypes.join(',')}
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files?.length) void handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
            {uploading ? (
              <>
                <strong>Uploading {uploading.name}…</strong>
                <div className="progress">
                  <div style={{ width: `${uploading.pct}%` }} />
                </div>
              </>
            ) : (
              <>
                <strong>Drop images here</strong>
                <div className="small muted" style={{ marginTop: 4 }}>
                  or click to choose · up to {media?.maxUploadMb ?? 15} MB each
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="banner info" style={{ marginBottom: 0 }}>
            Uploads are off — the backend has no S3 bucket configured. Paste an image URL below
            instead; that works exactly the same for the app.
          </div>
        )}

        <div className="row" style={{ marginTop: 10 }}>
          {uploadsOn && (
            <button onClick={() => void openLibrary()}>Pick from library…</button>
          )}
          {gifSearchOn && (
            <button onClick={() => setShowGifs((v) => !v)}>
              {showGifs ? 'Hide GIF search' : 'Find a GIF…'}
            </button>
          )}
          {!adding && <button onClick={() => setAdding(true)}>Paste a URL…</button>}
        </div>

        {showGifs && (
          <GifSearch
            folder={pack.slug}
            onImported={(asset, result) => {
              const taken = new Set(pack.assetManifest.map((a) => a.id));
              addAsset(suggestId(asset.originalName, taken), asset.url, {
                type: 'gif',
                bytes: asset.byteLength,
                width: result.width || undefined,
                height: result.height || undefined,
                loop: true,
              });
              setLibrary(null); // stale — the import joined the library
              setShowGifs(false);
            }}
            onError={setError}
          />
        )}

        {showLibrary && (
          <LibraryPicker
            assets={library}
            taken={new Set(pack.assetManifest.map((a) => a.url).filter(Boolean) as string[])}
            onPick={(asset) => {
              const taken = new Set(pack.assetManifest.map((a) => a.id));
              addAsset(suggestId(asset.originalName, taken), asset.url);
              setShowLibrary(false);
            }}
            onClose={() => setShowLibrary(false)}
          />
        )}

        {adding && (
          <div className="asset-row" style={{ alignItems: 'end', marginTop: 10 }}>
            {newUrl ? (
              <img className="thumb" src={newUrl} alt="" />
            ) : (
              <div className="thumb empty">▨</div>
            )}
            <div>
              <label>Id</label>
              <input
                className="mono"
                autoFocus
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="img_pot"
              />
            </div>
            <div>
              <label>Image URL</label>
              <input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') add();
                }}
                placeholder="https://…"
              />
            </div>
            <div className="row">
              <button className="primary" disabled={!newId.trim() || !newUrl.trim()} onClick={add}>
                Add
              </button>
              <button className="ghost" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── This pack's manifest ── */}
      <div className="section">
        <h3>In this pack ({pack.assetManifest.length})</h3>
        {pack.assetManifest.length === 0 && (
          <p className="small muted" style={{ marginTop: 0 }}>
            No pictures yet — every scene is drawn by the app. Add one to make this pack richer.
          </p>
        )}

        {pack.assetManifest.map((asset, index) => {
          const used = usage.get(asset.id) ?? [];
          return (
            <div className="asset-row" key={index}>
              {asset.url ? (
                <img className="thumb" src={asset.url} alt="" loading="lazy" />
              ) : (
                <div className="thumb empty">▨</div>
              )}
              <div>
                <input
                  className="mono"
                  value={asset.id}
                  onChange={(e) => rename(index, e.target.value)}
                  placeholder="img_cover"
                />
                <select
                  value={asset.type}
                  onChange={(e) => update(index, { type: e.target.value as 'image' })}
                  style={{ marginTop: 6 }}
                >
                  {ASSET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <input
                  value={asset.url ?? ''}
                  onChange={(e) => update(index, { url: e.target.value })}
                  placeholder="https://…"
                />
                <div className="small muted" style={{ marginTop: 4 }}>
                  {used.length > 0 ? (
                    <>Used by scene {used.join(', ')}</>
                  ) : pack.cover.image === asset.id ? (
                    <>Cover only</>
                  ) : (
                    <span className="badge draft">unused</span>
                  )}
                  {asset.bytes ? ` · ${humanSize(asset.bytes)}` : ''}
                  {asset.url && !asset.url.startsWith('https://') && (
                    <span className="badge bad" style={{ marginLeft: 6 }}>
                      must be https
                    </span>
                  )}
                </div>
              </div>
              <button
                className="danger ghost"
                title={used.length > 0 ? 'Still used by a scene' : 'Remove from this pack'}
                onClick={() => {
                  if (
                    used.length > 0 &&
                    !window.confirm(
                      `“${asset.id}” is used by scene ${used.join(', ')}. Remove it anyway? Those scenes will need a new picture before you can save.`,
                    )
                  ) {
                    return;
                  }
                  onChange(pack.assetManifest.filter((_, i) => i !== index));
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
        {pack.assetManifest.length > 0 && (
          <p className="small muted">
            Removing a picture here only takes it out of this pack — the file stays in the library
            for other packs to use.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Find an animated GIF for a scene — and copy it into our own bucket.
 *
 * The search runs server-side (the Giphy key never reaches this browser), and
 * picking a result does NOT paste Giphy's URL into the pack: the backend
 * downloads the file and stores it with our other artwork. Two reasons, both
 * load-bearing for a children's app:
 *
 *   • Giphy's own `rating=g` filter is documented as leaky, so the safety
 *     boundary is YOU looking at the clip, not a query parameter.
 *   • A hotlinked file can change or vanish under a published pack. A copy
 *     can't.
 *
 * So: search widely, look carefully, and only what you pick ships.
 */
function GifSearch({
  folder,
  onImported,
  onError,
}: {
  folder: string;
  onImported: (asset: MediaAsset, result: GifResult) => void;
  onError: (message: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GifResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);

  async function search(): Promise<void> {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    onError('');
    try {
      const body = await api.get<{ items: GifResult[] }>(
        `/v1/admin/media/gif-search?q=${encodeURIComponent(q)}`,
      );
      setResults(body.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function importGif(result: GifResult): Promise<void> {
    setImporting(result.id);
    onError('');
    try {
      const asset = await api.post<MediaAsset>('/v1/admin/media/gif-import', {
        url: result.importUrl,
        name: `${result.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 40) || 'clip'}.${
          result.mime === 'image/webp' ? 'webp' : 'gif'
        }`,
        folder,
      });
      onImported(asset, result);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(null);
    }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="section">
        <div className="row" style={{ marginBottom: 10 }}>
          <input
            className="grow"
            autoFocus
            placeholder="Search for an animation — “twinkling star”, “busy bee”…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void search();
            }}
          />
          <button className="primary" disabled={!query.trim() || searching} onClick={() => void search()}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>

        <div className="banner info" style={{ marginBottom: 10 }}>
          Look at each clip before you pick it. Results are filtered, but the
          filter is not a guarantee — you are. Picking one copies the file into
          our own storage, so the app never loads anything from Giphy.
        </div>

        {results === null ? (
          <div className="empty-state">Search to see animations.</div>
        ) : results.length === 0 ? (
          <div className="empty-state">Nothing found. Try different words.</div>
        ) : (
          <div className="library">
            {results.map((result) => (
              <button
                key={result.id}
                className="library-item"
                disabled={importing !== null}
                onClick={() => void importGif(result)}
                title={result.title}
              >
                <img src={result.previewUrl} alt="" loading="lazy" />
                <div className="small mono">{result.title}</div>
                <div className="small muted">
                  {importing === result.id ? 'Importing…' : humanSize(result.byteLength)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Pictures already uploaded, so the same illustration can back several packs
 *  without re-uploading it. */
function LibraryPicker({
  assets,
  taken,
  onPick,
  onClose,
}: {
  assets: MediaAsset[] | null;
  taken: Set<string>;
  onPick: (asset: MediaAsset) => void;
  onClose: () => void;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const visible = (assets ?? []).filter((a) =>
    a.originalName.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="section">
        <div className="row" style={{ marginBottom: 10 }}>
          <input
            className="grow"
            placeholder="Search uploaded pictures…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        {assets === null ? (
          <div className="empty-state">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            {assets.length === 0
              ? 'Nothing uploaded yet. Drop a file above and it lands here.'
              : 'Nothing matches that search.'}
          </div>
        ) : (
          <div className="library">
            {visible.map((asset) => (
              <button
                key={asset.id}
                className="library-item"
                onClick={() => onPick(asset)}
                title={asset.originalName}
              >
                <img src={asset.url} alt="" loading="lazy" />
                <div className="small mono">{asset.originalName}</div>
                <div className="small muted">
                  {humanSize(asset.byteLength)}
                  {taken.has(asset.url) && (
                    <span className="badge live" style={{ marginLeft: 6 }}>
                      in pack
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { navigate } from './App';
import { newPackTemplate } from './template';
import type { PackKind, PackRow } from './types';

// The library. Its job is triage: at a glance, which packs are live, which are
// missing a picture, and which have no recorded voice yet.

const KIND_LABEL: Record<PackKind, string> = {
  story: 'story',
  poem: 'poem',
  abc: 'letter',
};

export function PackList({ kind }: { kind: PackKind }): JSX.Element {
  const [rows, setRows] = useState<PackRow[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyDrafts, setOnlyDrafts] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const body = await api.get<{ items: PackRow[] }>(`/v1/admin/packs?kind=${kind}&limit=200`);
      setRows(body.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRows([]);
    }
  }, [kind]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (rows ?? []).filter((row) => {
      if (onlyDrafts && row.published) return false;
      if (!needle) return true;
      return (
        row.slug.toLowerCase().includes(needle) || row.titleEn.toLowerCase().includes(needle)
      );
    });
  }, [rows, search, onlyDrafts]);

  async function createPack(): Promise<void> {
    try {
      const created = await api.post<PackRow>('/v1/admin/packs', newPackTemplate(kind));
      navigate(`#/packs/${kind}/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function togglePublish(row: PackRow): Promise<void> {
    setError('');
    try {
      await api.patch(`/v1/admin/packs/${row.id}/publish`, { published: !row.published });
      await load();
    } catch (err) {
      // Publishing re-validates, so this is usually "the pack isn't finished".
      setError(
        `Could not ${row.published ? 'unpublish' : 'publish'} “${row.titleEn}”:\n${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async function remove(row: PackRow): Promise<void> {
    if (!window.confirm(`Delete “${row.titleEn}” and its recorded narration? This cannot be undone.`)) {
      return;
    }
    try {
      await api.del(`/v1/admin/packs/${row.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <div className="toolbar-sticky row wrap-items">
        <input
          className="grow"
          placeholder={`Search ${KIND_LABEL[kind]}s by title or slug…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <label className="row small" style={{ margin: 0, gap: 6, whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={onlyDrafts}
            onChange={(e) => setOnlyDrafts(e.target.checked)}
            style={{ width: 'auto' }}
          />
          Drafts only
        </label>
        <div className="spacer grow" />
        <button onClick={() => setImporting(true)}>Import JSON…</button>
        <button className="primary" onClick={() => void createPack()}>
          New {KIND_LABEL[kind]}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}
      {importing && (
        <ImportPanel
          onClose={() => setImporting(false)}
          onImported={(id) => navigate(`#/packs/${kind}/${id}`)}
        />
      )}

      <div className="card">
        {rows === null ? (
          <div className="empty-state">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            {rows.length === 0
              ? `No ${KIND_LABEL[kind]}s yet. Create one, or import a pack JSON.`
              : 'Nothing matches that filter.'}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 60 }}>Cover</th>
                <th>Title</th>
                {kind === 'poem' && <th style={{ width: 100 }}>Topic</th>}
                {kind === 'abc' && <th style={{ width: 70 }}>Letter</th>}
                {kind === 'story' && <th style={{ width: 90 }}>Age</th>}
                <th style={{ width: 90 }}>Scenes</th>
                <th style={{ width: 130 }}>Art</th>
                <th style={{ width: 130 }}>Voice</th>
                <th style={{ width: 90 }}>State</th>
                <th style={{ width: 190 }} />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.coverUrl ? (
                      <img className="thumb" src={row.coverUrl} alt="" loading="lazy" />
                    ) : (
                      <div className="thumb empty">{row.emoji}</div>
                    )}
                  </td>
                  <td>
                    <a
                      href={`#/packs/${kind}/${row.id}`}
                      style={{ fontWeight: 600, textDecoration: 'none' }}
                    >
                      {row.titleEn || row.slug}
                    </a>
                    <div className="mono muted">{row.slug}</div>
                  </td>
                  {kind === 'poem' && <td className="small">{row.topic ?? '—'}</td>}
                  {kind === 'abc' && <td className="small">{row.letter ?? '—'}</td>}
                  {kind === 'story' && <td className="small">{row.ageBand}</td>}
                  <td className="small">
                    {row.moments} · {row.minutes} min
                  </td>
                  <td>
                    {row.missingArt > 0 ? (
                      <span className="badge bad">{row.missingArt} missing</span>
                    ) : row.assets === 0 ? (
                      <span className="badge draft">vector only</span>
                    ) : (
                      <span className="badge live">{row.assets} pictures</span>
                    )}
                  </td>
                  <td>
                    {row.clips === 0 ? (
                      <span className="badge warn">TTS only</span>
                    ) : row.clips < row.expectedClips ? (
                      <span className="badge warn">
                        {row.clips}/{row.expectedClips}
                      </span>
                    ) : (
                      <span className="badge live">recorded</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${row.published ? 'live' : 'draft'}`}>
                      {row.published ? 'live' : 'draft'}
                    </span>
                  </td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button onClick={() => navigate(`#/packs/${kind}/${row.id}`)}>Edit</button>
                      <button onClick={() => void togglePublish(row)}>
                        {row.published ? 'Unpublish' : 'Publish'}
                      </button>
                      <button className="danger ghost" onClick={() => void remove(row)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/** Paste a v3 pack document — how the bundled reference stories and packs
 *  exported from another environment get in. */
function ImportPanel({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (id: string) => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    setError('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError('That is not valid JSON.');
      setBusy(false);
      return;
    }
    try {
      const created = await api.post<{ id: string }>('/v1/admin/packs/import', parsed);
      onImported(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section">
        <h3>Import a pack</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Paste a schema-3.0 pack document. It lands as a draft so you can review it before
          children see it.
        </p>
        {error && <div className="banner error">{error}</div>}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{ "schemaVersion": "3.0", "slug": "…", "moments": [ … ] }'
          style={{ minHeight: 180, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
        />
        <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !text.trim()} onClick={() => void submit()}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

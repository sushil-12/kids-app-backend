import { useCallback, useEffect, useState } from 'react';
import { api, adminKey, setAdminKey, ApiError } from './api';
import { PackList } from './PackList';
import { PackEditor } from './PackEditor';
import type { PackKind } from './types';

// Routing is a hash, not a router library: this portal has exactly two screens
// and lives behind an admin key, so a dependency to manage that would be noise.
//   #/packs/story        the library, filtered by kind
//   #/packs/<kind>/<id>  the editor
type Route = { screen: 'list'; kind: PackKind } | { screen: 'editor'; kind: PackKind; id: string };

function parseHash(): Route {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const kind = (parts[1] ?? 'story') as PackKind;
  if (parts[0] === 'packs' && parts[2]) return { screen: 'editor', kind, id: parts[2] };
  return { screen: 'list', kind };
}

export function navigate(hash: string): void {
  window.location.hash = hash;
}

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>(parseHash);
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const onHash = (): void => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // There is no login endpoint — the key IS the credential — so "signed in"
  // means "a request with this key succeeds". One cheap call answers that.
  const check = useCallback(async () => {
    if (!adminKey()) {
      setAuthed(false);
      return;
    }
    try {
      await api.get('/v1/admin/packs?limit=1');
      setAuthed(true);
    } catch (err) {
      setAuthed(!(err instanceof ApiError && err.status === 401));
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (authed === null) {
    return <div className="empty-state">Checking your key…</div>;
  }
  if (!authed) {
    return <KeyGate onDone={() => void check()} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          BrightMind <span>Content</span>
        </div>
        <div className="tabs">
          {(['story', 'poem', 'abc'] as PackKind[]).map((k) => (
            <button
              key={k}
              className={`tab ${route.kind === k ? 'active' : ''}`}
              onClick={() => navigate(`#/packs/${k}`)}
            >
              {k === 'story' ? 'Stories' : k === 'poem' ? 'Poems' : 'ABC'}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <a className="small" href="/v1/admin" target="_blank" rel="noreferrer">
          Coloring · Crawl · RAG · Jobs ↗
        </a>
        <button
          className="ghost small"
          onClick={() => {
            setAdminKey('');
            setAuthed(false);
          }}
        >
          Sign out
        </button>
      </header>

      <div className="content">
        <div className="wrap">
          {route.screen === 'list' ? (
            <PackList kind={route.kind} />
          ) : (
            <PackEditor id={route.id} kind={route.kind} />
          )}
        </div>
      </div>
    </div>
  );
}

function KeyGate({ onDone }: { onDone: () => void }): JSX.Element {
  const [value, setValue] = useState(adminKey());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    setAdminKey(value);
    try {
      await api.get('/v1/admin/packs?limit=1');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the backend.');
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="card" onSubmit={submit}>
        <h1>BrightMind Content</h1>
        <p className="muted small" style={{ marginTop: 0 }}>
          Stories, poems and ABC packs. Paste the admin key to continue.
        </p>
        {error && <div className="banner error">{error}</div>}
        <div className="field">
          <label htmlFor="key">Admin key</label>
          <input
            id="key"
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="ADMIN_API_KEY"
          />
        </div>
        <button className="primary" type="submit" disabled={busy || !value.trim()}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}

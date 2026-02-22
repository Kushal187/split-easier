import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [households, setHouseholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/households')
      .then((data) => {
        if (!cancelled) setHouseholds(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!cancelled) {
          if (err.status === 401) logout();
          setError(err.data?.error || err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function handleCreateHousehold(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError('');
    setCreating(true);
    try {
      const created = await api.post('/households', { name: newName.trim() });
      setHouseholds((prev) => [created, ...prev]);
      setNewName('');
      navigate(`/households/${created.id}`);
    } catch (err) {
      setError(err.data?.error || err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="app">
      <header className="appHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 className="appTitle">Split Wiser</h1>
          <p className="appTagline">Hi, {user?.name ?? user?.email}</p>
        </div>
        <button type="button" className="btnGhost" onClick={() => logout()}>
          Sign out
        </button>
      </header>

      <section>
        <h2 className="sectionTitle">Households</h2>
        <div className="card">
          <form onSubmit={handleCreateHousehold} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label>
              Create a household
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Roommates, Trip to NYC"
              />
            </label>
            <button type="submit" className="btnPrimary" disabled={creating || !newName.trim()}>
              {creating ? 'Creating…' : 'Create household'}
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </div>

        {loading ? (
          <p className="subtext">Loading…</p>
        ) : households.length === 0 ? (
          <div className="card">
            <p className="subtext">No households yet. Create one above to start splitting bills.</p>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {households.map((h) => (
              <li key={h.id}>
                <Link
                  to={`/households/${h.id}`}
                  style={{
                    display: 'block',
                    padding: 16,
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    textDecoration: 'none',
                    color: 'var(--text)',
                    fontWeight: 500
                  }}
                >
                  {h.name}
                  <span className="subtext" style={{ display: 'block', marginTop: 4 }}>
                    {h.members?.length ?? 0} member{h.members?.length === 1 ? '' : 's'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

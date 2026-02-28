import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Users, ChevronRight, LogOut, Home, X, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { BrandIcon, BrandWordmark } from '../components/BrandLogo.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { api } from '../api/client.js';

const HOUSEHOLD_COLORS = [
  'avatar-gradient--indigo',
  'avatar-gradient--purple',
  'avatar-gradient--emerald',
  'avatar-gradient--rose',
  'avatar-gradient--amber',
  'avatar-gradient--blue',
];

function getHouseholdColor(id) {
  const sum = (id || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return HOUSEHOLD_COLORS[sum % HOUSEHOLD_COLORS.length];
}

function getHouseholdInitial(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [households, setHouseholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [importing, setImporting] = useState(false);

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
      setShowCreate(false);
      navigate(`/households/${created.id}`);
    } catch (err) {
      setError(err.data?.error || err.message);
    } finally {
      setCreating(false);
    }
  }

  async function importSplitwiseGroups() {
    setError('');
    setImporting(true);
    try {
      const result = await api.post('/households/import-splitwise', {});
      const imported = Array.isArray(result?.households) ? result.households : [];
      if (imported.length > 0) {
        setHouseholds((prev) => {
          const byId = new Map(prev.map((h) => [h.id, h]));
          imported.forEach((h) => byId.set(h.id, h));
          return [...byId.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        });
      } else {
        const refreshed = await api.get('/households');
        setHouseholds(Array.isArray(refreshed) ? refreshed : []);
      }
    } catch (err) {
      setError(err.data?.error || err.message);
    } finally {
      setImporting(false);
    }
  }

  const firstName = (user?.name || user?.email || '').split(/\s/)[0] || 'there';

  return (
    <div className="page-dark">
      <div className="page-orbs">
        <div className="page-orb page-orb--indigo" style={{ width: 400, height: 400, filter: 'blur(100px)', opacity: 0.3 }} />
        <div className="page-orb page-orb--violet" style={{ width: 300, height: 300, bottom: 0, right: 0, filter: 'blur(80px)', opacity: 0.3 }} />
      </div>

      <div className="page-content app-shell">
        <header className="header-bar">
          <div className="header-inner">
            <Link to="/dashboard" className="header-logo">
              <div className="header-logo-icon">
                <BrandIcon />
              </div>
              <BrandWordmark className="header-logo-text" />
            </Link>
            <div className="header-user">
              <ThemeToggle />
              <div className="visible-sm-flex" style={{ alignItems: 'center', gap: 8 }}>
                <div className="header-avatar">
                  {(user?.name || user?.email || '?').charAt(0).toUpperCase()}
                </div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{user?.name || user?.email}</span>
              </div>
              <button type="button" className="header-signout" onClick={() => logout()}>
                <LogOut size={16} />
                <span className="hidden-sm">Sign out</span>
              </button>
            </div>
          </div>
        </header>

        <main className="app" style={{ maxWidth: 896, margin: '0 auto', padding: '40px 24px calc(40px + var(--safe-area-bottom))' }}>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-10"
          >
            <h1 className="welcome-title">Hey, {firstName}!</h1>
            <p className="welcome-sub">Manage your shared households and bills.</p>
          </motion.div>

          <div className="section-header dashboard-section-header">
            <h2 className="section-label">Households</h2>
            <div className="dashboard-actions">
              <button
                type="button"
                className="btn-sm-primary"
                onClick={importSplitwiseGroups}
                disabled={importing}
              >
                <RefreshCw size={14} />
                {importing ? 'Importing…' : 'Import Splitwise'}
              </button>
              <button
                type="button"
                className="btn-sm-primary"
                onClick={() => setShowCreate(true)}
              >
                <Plus size={14} />
                New household
              </button>
            </div>
          </div>

          <AnimatePresence>
            {showCreate && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="create-block"
              >
                <div className="create-block-header">
                  <h3 className="create-block-title">Create a household</h3>
                  <button
                    type="button"
                    className="create-block-close"
                    onClick={() => { setShowCreate(false); setNewName(''); }}
                  >
                    <X size={16} />
                  </button>
                </div>
                <form onSubmit={handleCreateHousehold} className="create-block-form">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Roommates, Trip to NYC"
                    className="input-glass"
                    autoFocus
                  />
                  <button type="submit" className="btn-create" disabled={creating || !newName.trim()}>
                    {creating ? 'Creating…' : 'Create'}
                  </button>
                </form>
                {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
              </motion.div>
            )}
          </AnimatePresence>

          {loading ? (
            <p className="welcome-sub">Loading…</p>
          ) : households.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="empty-state"
            >
              <div className="empty-state-icon">
                <Home size={28} />
              </div>
              <p className="empty-state-title">No households yet</p>
              <p className="empty-state-sub">Create one to start splitting bills</p>
            </motion.div>
          ) : (
            <div className="household-grid">
              {households.map((h, i) => (
                <motion.div
                  key={h.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                >
                  <Link to={`/households/${h.id}`} className="household-card">
                    <div className={`household-card-avatar ${getHouseholdColor(h.id)}`}>
                      {getHouseholdInitial(h.name)}
                    </div>
                    <div className="household-card-body">
                      <div className="household-card-name">{h.name}</div>
                      <div className="household-card-meta">
                        <Users size={14} />
                        <span>{h.members?.length ?? 0} member{(h.members?.length ?? 0) === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                    <ChevronRight size={16} className="household-card-chevron" />
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

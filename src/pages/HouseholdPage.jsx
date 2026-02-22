import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';

function ReceiptEmptyIcon() {
  return (
    <svg className="emptyStateIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  );
}

function formatMoney(value) {
  return `$${Number(value).toFixed(2)}`;
}

function getInitial(name) {
  return (name || '?').charAt(0).toUpperCase();
}

/** Per-person breakdown: what each person owes and for which items (item name + their share). */
function buildBreakdown(items) {
  const breakdown = {};
  if (!items || !Array.isArray(items)) return breakdown;
  items.forEach((item) => {
    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !item.splitBetween?.length) return;
    const share = amount / item.splitBetween.length;
    item.splitBetween.forEach((userId) => {
      const key = typeof userId === 'object' && userId?.toString ? userId.toString() : String(userId);
      if (!breakdown[key]) breakdown[key] = [];
      breakdown[key].push({ name: item.name, share });
    });
  });
  return breakdown;
}

function ChevronDown({ open }) {
  return (
    <svg
      className="owedChevron"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function SavedBillCard({ bill }) {
  const [expandedUserIds, setExpandedUserIds] = useState(() => new Set());
  const names = bill.memberNames || {};
  const totalKeys = bill.totals ? Object.keys(bill.totals) : [];
  const breakdown = buildBreakdown(bill.items);

  function toggleExpanded(userId) {
    setExpandedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  return (
    <article className="savedBill">
      <h3 className="savedBillTitle">{bill.billName}</h3>
      <p className="savedBillMeta">
        {bill.createdAt ? new Date(bill.createdAt).toLocaleString() : ''} · Total {formatMoney(bill.totalAmount)}
      </p>
      <div className="owedCard savedBillTotals">
        {totalKeys.map((userId) => {
          const total = bill.totals[userId] ?? 0;
          const itemsForPerson = breakdown[userId] || [];
          const isExpanded = expandedUserIds.has(userId);
          const hasBreakdown = itemsForPerson.length > 0;
          return (
            <div key={userId} className="owedRowWrap">
              <button
                type="button"
                className={`owedRowClickable ${isExpanded ? 'owedRowExpanded' : ''}`}
                onClick={() => toggleExpanded(userId)}
                aria-expanded={hasBreakdown ? isExpanded : undefined}
              >
                <span className="personInitial">{getInitial(names[userId])}</span>
                <span className="personName">{names[userId] || userId}</span>
                <span className="personAmount">{formatMoney(total)}</span>
                {hasBreakdown && <ChevronDown open={isExpanded} />}
              </button>
              {hasBreakdown && isExpanded && (
                <ul className="owedBreakdownList">
                  {itemsForPerson.map((e, i) => (
                    <li key={i} className="owedBreakdownItem">
                      <span>{e.name}</span>
                      <span className="owedBreakdownAmount">{formatMoney(e.share)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}

export default function HouseholdPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [household, setHousehold] = useState(null);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [showNewBill, setShowNewBill] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get(`/households/${id}`), api.get(`/households/${id}/bills`).catch(() => [])])
      .then(([h, b]) => {
        if (!cancelled) {
          setHousehold(h);
          setBills(Array.isArray(b) ? b : []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          if (err.status === 401) logout();
          else setError(err.data?.error || err.message);
          if (err.status === 404 || err.status === 403) navigate('/', { replace: true });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, navigate]);

  async function addMember(e) {
    e.preventDefault();
    if (!memberEmail.trim()) return;
    setError('');
    setAddingMember(true);
    try {
      const updated = await api.post(`/households/${id}/members`, { email: memberEmail.trim() });
      setHousehold(updated);
      setMemberEmail('');
    } catch (err) {
      setError(err.data?.error || err.message);
    } finally {
      setAddingMember(false);
    }
  }

  function removeMember(memberUserId) {
    if (!household || household.ownerId !== user?.id) return;
    if (!confirm('Remove this member from the household?')) return;
    api
      .delete(`/households/${id}/members/${memberUserId}`)
      .then(setHousehold)
      .catch((err) => setError(err.data?.error || err.message));
  }

  if (loading) {
    return (
      <main className="app">
        <p className="subtext">Loading…</p>
      </main>
    );
  }
  if (!household) return null;

  const isOwner = household.ownerId === user?.id;
  const members = household.members || [];

  return (
    <main className="app">
      <header className="appHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Link to="/" className="btnGhost" style={{ padding: 0, minHeight: 'auto', marginBottom: 4 }}>
            ← Back
          </Link>
          <h1 className="appTitle">{household.name}</h1>
          <p className="appTagline">Household · {members.length} member{members.length === 1 ? '' : 's'}</p>
        </div>
      </header>

      <section>
        <h2 className="sectionTitle">Members</h2>
        <div className="card">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {members.map((m) => (
              <li
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 0',
                  borderBottom: '1px solid var(--border)'
                }}
              >
                <span className="personInitial" style={{ marginRight: 12 }}>{getInitial(m.name)}</span>
                <span style={{ flex: 1 }}>{m.name}</span>
                <span className="subtext">{m.email}</span>
                {isOwner && m.id !== user?.id && (
                  <button
                    type="button"
                    className="btnGhost"
                    style={{ marginLeft: 8 }}
                    onClick={() => removeMember(m.id)}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isOwner && (
            <form onSubmit={addMember} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                type="email"
                value={memberEmail}
                onChange={(e) => setMemberEmail(e.target.value)}
                placeholder="Add member by email"
                style={{ flex: 1 }}
              />
              <button type="submit" className="btnPrimary" disabled={addingMember || !memberEmail.trim()}>
                {addingMember ? 'Adding…' : 'Add'}
              </button>
            </form>
          )}
          {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
        </div>
      </section>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 className="sectionTitle">Bills</h2>
          <button type="button" className="btnPrimary" onClick={() => setShowNewBill((v) => !v)}>
            {showNewBill ? 'Cancel' : 'New bill'}
          </button>
        </div>

        {showNewBill && (
          <div className="card" style={{ marginBottom: 16 }}>
            <NewBillForm
              householdId={id}
              members={members}
              onSaved={() => {
                setShowNewBill(false);
                api.get(`/households/${id}/bills`).then((b) => setBills(Array.isArray(b) ? b : []));
              }}
              onCancel={() => setShowNewBill(false)}
            />
          </div>
        )}

        <div className="card">
          {bills.length === 0 ? (
            <div className="emptyState">
              <ReceiptEmptyIcon />
              <p>No bills yet. Create a bill to get started.</p>
            </div>
          ) : (
            <div className="savedBills">
              {bills.map((bill) => (
                <SavedBillCard key={bill.id} bill={bill} />
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function NewBillForm({ householdId, members, onSaved, onCancel }) {
  const [billName, setBillName] = useState('');
  const [itemForm, setItemForm] = useState({ name: '', amount: '', splitBetween: [] });
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function toggleMember(userId) {
    setItemForm((c) => {
      const inList = c.splitBetween.includes(userId);
      const splitBetween = inList ? c.splitBetween.filter((id) => id !== userId) : [...c.splitBetween, userId];
      return { ...c, splitBetween };
    });
  }

  function addItem() {
    const amount = Number(itemForm.amount);
    if (!itemForm.name.trim()) {
      setError('Item name is required.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be greater than 0.');
      return;
    }
    if (itemForm.splitBetween.length === 0) {
      setError('Pick at least one person to split with.');
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: itemForm.name.trim(),
        amount,
        splitBetween: [...itemForm.splitBetween]
      }
    ]);
    setItemForm({ name: '', amount: '', splitBetween: [] });
    setError('');
  }

  function removeItem(itemId) {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  }

  function buildTotals() {
    const totals = {};
    members.forEach((m) => (totals[m.id] = 0));
    items.forEach((item) => {
      const share = item.amount / item.splitBetween.length;
      item.splitBetween.forEach((userId) => {
        totals[userId] = (totals[userId] ?? 0) + share;
      });
    });
    return totals;
  }

  async function finalize() {
    if (!billName.trim()) {
      setError('Bill name is required.');
      return;
    }
    if (items.length === 0) {
      setError('Add at least one item.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await api.post(`/households/${householdId}/bills`, {
        billName: billName.trim(),
        items: items.map((i) => ({ id: i.id, name: i.name, amount: i.amount, splitBetween: i.splitBetween }))
      });
      onSaved();
    } catch (err) {
      setError(err.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  }

  const draftTotals = buildTotals();
  const draftTotal = items.reduce((sum, i) => sum + i.amount, 0);

  return (
    <>
      <h3 className="cardTitle">This bill</h3>
      <label>
        Bill name
        <input
          value={billName}
          onChange={(e) => setBillName(e.target.value)}
          placeholder="e.g. Dinner at Pizza Place"
        />
      </label>
      <div className="divider" />
      <h3 className="cardTitle">Add item</h3>
      <label>
        Item name
        <input
          value={itemForm.name}
          onChange={(e) => setItemForm((c) => ({ ...c, name: e.target.value }))}
          placeholder="e.g. Margherita Pizza"
        />
      </label>
      <label>
        Amount ($)
        <input
          type="number"
          min="0"
          step="0.01"
          value={itemForm.amount}
          onChange={(e) => setItemForm((c) => ({ ...c, amount: e.target.value }))}
          placeholder="0.00"
        />
      </label>
      <fieldset>
        <legend>Split between</legend>
        <div className="chips">
          {members.map((m) => {
            const isActive = itemForm.splitBetween.includes(m.id);
            return (
              <button
                type="button"
                key={m.id}
                className={`chip ${isActive ? 'active' : ''}`}
                onClick={() => toggleMember(m.id)}
              >
                {m.name}
              </button>
            );
          })}
        </div>
      </fieldset>
      <button type="button" className="btnPrimary" onClick={addItem}>
        Add item to bill
      </button>
      {error && <p className="error">{error}</p>}

      {items.length > 0 && (
        <>
          <div className="divider" />
          <h3 className="cardTitle">Items</h3>
          <ul className="itemList">
            {items.map((item) => (
              <li key={item.id} className="itemRow">
                <div className="itemInfo">
                  <div className="itemName">{item.name}</div>
                  <div className="itemMeta">
                    Split: {item.splitBetween.map((id) => members.find((m) => m.id === id)?.name ?? id).join(', ')}
                  </div>
                </div>
                <span className="itemAmount">{formatMoney(item.amount)}</span>
                <button type="button" className="btnGhost" onClick={() => removeItem(item.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <p className="subtext">Bill total: <span className="amount">{formatMoney(draftTotal)}</span></p>
          <h3 className="cardTitle">Who owes what</h3>
          <div className="owedCard">
            {members.map((m) => (
              <div key={m.id} className="owedRow">
                <span className="personInitial">{getInitial(m.name)}</span>
                <span className="personName">{m.name}</span>
                <span className="personAmount">{formatMoney(draftTotals[m.id] ?? 0)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btnPrimary" onClick={finalize} disabled={saving}>
              {saving ? 'Saving…' : 'Save bill'}
            </button>
            <button type="button" className="btnGhost" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </>
  );
}

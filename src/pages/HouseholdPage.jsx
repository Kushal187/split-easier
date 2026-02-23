import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  Receipt,
  Users,
  Plus,
  Upload,
  X,
  ChevronDown,
  ChevronUp,
  UserMinus,
  UserPlus,
  ShoppingCart,
  Check,
  Pencil,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { api } from '../api/client.js';

const AVATAR_COLORS = [
  'avatar-gradient--indigo',
  'avatar-gradient--emerald',
  'avatar-gradient--rose',
  'avatar-gradient--amber',
  'avatar-gradient--blue',
  'avatar-gradient--purple',
];

function getAvatarColor(str) {
  const sum = (str || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function formatMoney(value) {
  return `$${Number(value).toFixed(2)}`;
}

function getInitial(name) {
  return (name || '?').charAt(0).toUpperCase();
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
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

function SavedBillCard({ bill, canEdit, onEdit, onDelete, deleting }) {
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
    <motion.article
      className="bill-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="bill-card-header">
        <div>
          <div className="bill-card-title">{bill.billName}</div>
          <div className="bill-card-date">{formatDate(bill.createdAt)}</div>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', gap: 12, alignItems: 'center' }}>
          <div>
            <div className="bill-card-total-label">Total</div>
            <div className="bill-card-total-value">{formatMoney(bill.totalAmount)}</div>
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn-remove-member" onClick={onEdit} title="Edit bill">
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className="btn-remove-member"
                onClick={onDelete}
                disabled={deleting}
                title="Delete bill"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="bill-card-body">
        {bill?.splitwiseSync?.status && (
          <div className="bill-sync-note" style={{ marginBottom: 12, color: 'var(--text-muted-2)', fontSize: '0.8rem' }}>
            Splitwise sync: <strong style={{ color: 'var(--text)' }}>{bill.splitwiseSync.status}</strong>
            {bill?.splitwiseSync?.expenseId ? ` (expense #${bill.splitwiseSync.expenseId})` : ''}
            {bill?.splitwiseSync?.error ? ` - ${bill.splitwiseSync.error}` : ''}
          </div>
        )}
        {totalKeys.map((userId) => {
          const total = bill.totals[userId] ?? 0;
          const itemsForPerson = breakdown[userId] || [];
          const isExpanded = expandedUserIds.has(userId);
          const hasBreakdown = itemsForPerson.length > 0;
          return (
            <div key={userId} className="bill-member-row">
              <button
                type="button"
                className="bill-member-toggle"
                onClick={() => toggleExpanded(userId)}
                aria-expanded={hasBreakdown ? isExpanded : undefined}
              >
                <span className={`avatar-gradient ${getAvatarColor(userId)}`}>
                  {getInitial(names[userId])}
                </span>
                <span className="member-name bill-member-name">
                  {names[userId] || userId}
                </span>
                <span className="bill-member-amount">{formatMoney(total)}</span>
                {hasBreakdown && (
                  <span className="bill-member-chevron">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </span>
                )}
              </button>
              {hasBreakdown && isExpanded && (
                <div className="bill-breakdown">
                  {itemsForPerson.map((e, i) => (
                    <div key={i} className="bill-breakdown-item">
                      <span>{e.name}</span>
                      <span>{formatMoney(e.share)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </motion.article>
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
  const [editingBillId, setEditingBillId] = useState(null);
  const [deletingBillId, setDeletingBillId] = useState(null);
  const [syncingSplitwise, setSyncingSplitwise] = useState(false);
  const [syncSummary, setSyncSummary] = useState('');

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

  async function refreshBills() {
    const data = await api.get(`/households/${id}/bills`).catch(() => []);
    setBills(Array.isArray(data) ? data : []);
  }

  async function deleteBill(billId) {
    if (!confirm('Delete this bill? This will only remove it in SplitEasier.')) return;
    setError('');
    setDeletingBillId(billId);
    try {
      const resp = await api.delete(`/households/${id}/bills/${billId}`);
      if (resp?.warning) setError(resp.warning);
      await refreshBills();
      if (editingBillId === billId) setEditingBillId(null);
    } catch (err) {
      setError(err.data?.error || err.message);
    } finally {
      setDeletingBillId(null);
    }
  }

  async function syncSplitwiseExpenses() {
    if (!household?.splitwiseGroupId || syncingSplitwise) return;
    setError('');
    setSyncSummary('');
    setSyncingSplitwise(true);
    try {
      const resp = await api.post(`/households/${id}/sync-splitwise`, {});
      await refreshBills();
      const summary = resp?.summary || {};
      const parts = [
        `${summary.created ?? 0} created`,
        `${summary.updated ?? 0} updated`,
        `${summary.deleted ?? 0} deleted`,
        `${summary.conflicts ?? 0} conflicts`,
      ];
      setSyncSummary(`Splitwise sync complete: ${parts.join(', ')}.`);
    } catch (err) {
      setError(err.data?.error || err.message);
    } finally {
      setSyncingSplitwise(false);
    }
  }

  if (loading) {
    return (
      <div className="page-dark auth-page">
        <p className="welcome-sub">Loading…</p>
      </div>
    );
  }
  if (!household) return null;

  const isOwner = household.ownerId === user?.id;
  const members = household.members || [];

  return (
    <div className="page-dark">
      <div className="page-orbs">
        <div className="page-orb page-orb--indigo" style={{ width: 300, height: 300, filter: 'blur(80px)', opacity: 0.25 }} />
        <div className="page-orb page-orb--violet" style={{ width: 250, height: 250, bottom: 0, right: 0, filter: 'blur(60px)', opacity: 0.25 }} />
      </div>

      <div className="page-content">
        <header className="header-bar" style={{ position: 'sticky', top: 0 }}>
          <div className="header-inner">
            <ThemeToggle />
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Link to="/dashboard" className="header-back">
                <ArrowLeft size={16} />
                <span className="hidden-sm">Dashboard</span>
              </Link>
              <div style={{ width: 1, height: 16, background: 'var(--glass-border)', flexShrink: 0 }} />
              <Link to="/dashboard" className="header-logo">
                <div className="header-logo-icon" style={{ width: 24, height: 24 }}>
                  <Receipt size={12} />
                </div>
                <span className="header-logo-text" style={{ fontSize: '0.875rem' }}>
                  Split<span>Easier</span>
                </span>
              </Link>
            </div>
          </div>
        </header>

        <main style={{ maxWidth: 896, margin: '0 auto', padding: '32px 24px' }}>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <h1 className="welcome-title">{household.name}</h1>
            <div className="household-card-meta" style={{ marginTop: 4 }}>
              <Users size={14} />
              <span>
                {members.length} member{members.length === 1 ? '' : 's'}
              </span>
              {bills.length > 0 && (
                <>
                  <span style={{ opacity: 0.2 }}>·</span>
                  <Receipt size={14} />
                  <span>{bills.length} bill{bills.length === 1 ? '' : 's'}</span>
                </>
              )}
            </div>
            {household.splitwiseGroupId && (
              <div className="household-card-meta" style={{ marginTop: 8 }}>
                <span>Linked Splitwise group: {household.splitwiseGroupName || household.splitwiseGroupId}</span>
              </div>
            )}
          </motion.div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {/* Members */}
            <section>
              <h2 className="section-label">Members</h2>
              <div className="members-card">
                <ul className="members-list">
                  {members.map((m, i) => (
                    <motion.li
                      key={m.id}
                      className="member-row"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06 }}
                    >
                      <span className={`avatar-gradient ${getAvatarColor(m.id)}`}>
                        {getInitial(m.name)}
                      </span>
                      <div className="member-info">
                        <div className="member-name">
                          {m.name}
                          {m.id === household.ownerId && <span className="badge-owner">owner</span>}
                          {m.id === user?.id && m.id !== household.ownerId && <span className="badge-you">you</span>}
                        </div>
                        <div className="member-email">{m.email}</div>
                      </div>
                      {isOwner && m.id !== user?.id && (
                        <button
                          type="button"
                          className="btn-remove-member"
                          onClick={() => removeMember(m.id)}
                          title="Remove member"
                        >
                          <UserMinus size={16} />
                        </button>
                      )}
                    </motion.li>
                  ))}
                </ul>
                {isOwner && (
                  <div className="add-member-footer">
                    {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
                    <form onSubmit={addMember} className="add-member-form">
                      <div style={{ position: 'relative', flex: 1 }}>
                        <UserPlus
                          size={16}
                          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.25)' }}
                        />
                        <input
                          type="email"
                          value={memberEmail}
                          onChange={(e) => { setMemberEmail(e.target.value); setError(''); }}
                          placeholder="Add member by email"
                          className="input-glass"
                          style={{ paddingLeft: 40, minHeight: 40, fontSize: '0.875rem' }}
                        />
                      </div>
                      <button
                        type="submit"
                        className="btn-add-member"
                        disabled={addingMember || !memberEmail.trim()}
                      >
                        {addingMember ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : 'Add'}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </section>

            {/* Bills */}
            <section>
              <div className="section-header">
                <h2 className="section-label">Bills</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  {household.splitwiseGroupId && (
                    <button
                      type="button"
                      className="btn-sm-primary"
                      onClick={syncSplitwiseExpenses}
                      disabled={syncingSplitwise}
                    >
                      <RefreshCw size={14} />
                      {syncingSplitwise ? 'Syncing…' : 'Sync Splitwise'}
                    </button>
                  )}
                  {!showNewBill && (
                    <button
                      type="button"
                      className="btn-sm-primary"
                      onClick={() => setShowNewBill(true)}
                      style={{ background: 'var(--gradient-start)', border: 'none', color: 'white', boxShadow: '0 4px 12px var(--gradient-shadow)' }}
                    >
                      <Plus size={14} />
                      New bill
                    </button>
                  )}
                </div>
              </div>
              {syncSummary && (
                <p className="welcome-sub" style={{ marginTop: 8, marginBottom: 0, fontSize: '0.8rem' }}>{syncSummary}</p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <AnimatePresence>
                  {showNewBill && (
                    <NewBillForm
                      key="new-bill"
                      householdId={id}
                      members={members}
                      onSaved={() => {
                        setShowNewBill(false);
                        refreshBills();
                      }}
                      onCancel={() => setShowNewBill(false)}
                    />
                  )}
                </AnimatePresence>

                {bills.map((bill) => (
                  editingBillId === bill.id ? (
                    <NewBillForm
                      key={`edit-${bill.id}`}
                      householdId={id}
                      members={members}
                      initialBill={bill}
                      mode="edit"
                      onSaved={() => {
                        setEditingBillId(null);
                        refreshBills();
                      }}
                      onCancel={() => setEditingBillId(null)}
                    />
                  ) : (
                    <SavedBillCard
                      key={bill.id}
                      bill={bill}
                      canEdit={bill.createdBy === user?.id}
                      deleting={deletingBillId === bill.id}
                      onEdit={() => {
                        setShowNewBill(false);
                        setEditingBillId(bill.id);
                      }}
                      onDelete={() => deleteBill(bill.id)}
                    />
                  )
                ))}

                {bills.length === 0 && !showNewBill && (
                  <div className="empty-state" style={{ padding: 48 }}>
                    <div className="empty-state-icon" style={{ width: 48, height: 48 }}>
                      <Receipt size={20} />
                    </div>
                    <p className="empty-state-title">No bills yet</p>
                    <p className="empty-state-sub">Create your first bill to start splitting</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function NewBillForm({ householdId, members, onSaved, onCancel, initialBill = null, mode = 'create' }) {
  const [billName, setBillName] = useState(initialBill?.billName || '');
  const [itemForm, setItemForm] = useState({ name: '', amount: '', splitBetween: [] });
  const [items, setItems] = useState(
    (initialBill?.items || []).map((i) => ({
      id: i.id || crypto.randomUUID(),
      name: i.name,
      amount: Number(i.amount),
      splitBetween: (i.splitBetween || []).map((id) => (typeof id === 'string' ? id : id.toString()))
    }))
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrMessage, setOcrMessage] = useState('');

  function toggleMember(userId) {
    setItemForm((c) => {
      const inList = c.splitBetween.includes(userId);
      const splitBetween = inList ? c.splitBetween.filter((id) => id !== userId) : [...c.splitBetween, userId];
      return { ...c, splitBetween };
    });
  }

  function addItem() {
    const amount = normalizeAmount(itemForm.amount);
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

  function updateItem(itemId, patch) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        return { ...item, ...patch };
      })
    );
  }

  function toggleItemMember(itemId, userId) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        const inList = item.splitBetween.includes(userId);
        const splitBetween = inList
          ? item.splitBetween.filter((id) => id !== userId)
          : [...item.splitBetween, userId];
        return { ...item, splitBetween };
      })
    );
  }

  function removeItem(itemId) {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  }

  async function importFromReceiptFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please upload an image receipt (JPG, PNG, WEBP, HEIC).');
      return;
    }

    const maxSize = 6 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('Image is too large. Max size is 6MB.');
      return;
    }

    setError('');
    setOcrMessage('');
    setOcrLoading(true);
    try {
      const imageDataUrl = await readFileAsDataUrl(file);
      const parsed = await api.post(`/households/${householdId}/bills/ocr`, {
        imageDataUrl,
        fileName: file.name
      });
      const importedItems = (parsed?.items || [])
        .map((item) => ({
          id: crypto.randomUUID(),
          name: item.name?.trim() || 'Item',
          amount: normalizeAmount(item.amount),
          splitBetween: members.map((m) => m.id)
        }))
        .filter((item) => item.name && item.amount > 0);

      if (importedItems.length === 0) {
        setError('No receipt items were detected. Try a clearer image.');
        return;
      }

      setItems((prev) => [...prev, ...importedItems]);
      if (!billName.trim() && parsed?.billName) {
        setBillName(parsed.billName);
      }
      setOcrMessage(`Imported ${importedItems.length} item${importedItems.length === 1 ? '' : 's'} from ${file.name}.`);
    } catch (err) {
      setError(err.data?.error || err.message || 'Failed to scan receipt.');
    } finally {
      setOcrLoading(false);
    }
  }

  function buildTotals() {
    const totals = {};
    members.forEach((m) => (totals[m.id] = 0));
    items.forEach((item) => {
      const amount = normalizeAmount(item.amount);
      if (amount <= 0 || item.splitBetween.length === 0) return;
      const share = amount / item.splitBetween.length;
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
    const allowedMemberIds = new Set(members.map((m) => m.id));
    const normalizedItems = items.map((item) => ({
      id: item.id || crypto.randomUUID(),
      name: item.name?.trim() || '',
      amount: normalizeAmount(item.amount),
      splitBetween: [...new Set((item.splitBetween || []).filter((id) => allowedMemberIds.has(id)))]
    }));

    const invalidNameIndex = normalizedItems.findIndex((item) => !item.name);
    if (invalidNameIndex >= 0) {
      setError(`Item ${invalidNameIndex + 1} needs a name.`);
      return;
    }
    const invalidAmountIndex = normalizedItems.findIndex((item) => item.amount <= 0);
    if (invalidAmountIndex >= 0) {
      setError(`Item ${invalidAmountIndex + 1} has an invalid amount.`);
      return;
    }
    const missingPeopleIndex = normalizedItems.findIndex((item) => item.splitBetween.length === 0);
    if (missingPeopleIndex >= 0) {
      setError(`Pick at least one person for item ${missingPeopleIndex + 1}.`);
      return;
    }

    setError('');
    setSaving(true);
    try {
      const payload = {
        billName: billName.trim(),
        items: normalizedItems
      };
      if (mode === 'edit' && initialBill?.id) {
        await api.patch(`/households/${householdId}/bills/${initialBill.id}`, payload);
      } else {
        await api.post(`/households/${householdId}/bills`, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  }

  const draftTotals = buildTotals();
  const draftTotal = items.reduce((sum, i) => sum + normalizeAmount(i.amount), 0);

  return (
    <motion.div
      className="new-bill-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
    >
      <div className="new-bill-card-header">
        <div className="new-bill-card-title-wrap">
          <div className="new-bill-card-title-icon">
            <Receipt size={14} />
          </div>
          <span className="new-bill-card-title-text" style={{ fontWeight: 600, color: 'var(--text)' }}>
            {mode === 'edit' ? 'Edit Bill' : 'New Bill'}
          </span>
        </div>
        <button type="button" className="new-bill-card-close" onClick={onCancel}>
          <X size={16} />
        </button>
      </div>

      <div className="new-bill-card-body">
        <div>
          <label className="label-glass">Bill name</label>
          <input
            type="text"
            value={billName}
            onChange={(e) => setBillName(e.target.value)}
            placeholder="e.g. Dinner at Pizza Place"
            className="input-glass"
            style={{ minHeight: 40, padding: '10px 14px', fontSize: '0.875rem' }}
            autoFocus
          />
        </div>

        <div className="receipt-ocr-block">
          <label className="label-glass">Auto-fill from receipt</label>
          <label className={`btn-add-item receipt-upload-btn ${ocrLoading ? 'receipt-upload-btn--disabled' : ''}`}>
            <Upload size={16} />
            {ocrLoading ? 'Scanning receipt…' : 'Upload receipt image'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
              onChange={importFromReceiptFile}
              disabled={ocrLoading}
            />
          </label>
          <p className="receipt-ocr-help">JPG, PNG, WEBP, or HEIC up to 6MB</p>
          {ocrMessage && <p className="receipt-ocr-message">{ocrMessage}</p>}
        </div>

        <div className="new-bill-divider" />

        <div className="new-bill-subtitle">
          <ShoppingCart size={16} className="new-bill-subtitle-icon" />
          <span className="new-bill-subtitle-text">Add items</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="new-bill-grid">
            <div>
              <label className="label-glass" style={{ fontSize: '0.75rem', marginBottom: 6 }}>Item name</label>
              <input
                type="text"
                value={itemForm.name}
                onChange={(e) => setItemForm((c) => ({ ...c, name: e.target.value }))}
                placeholder="e.g. Margherita Pizza"
                className="input-glass"
                style={{ minHeight: 40, padding: '10px 12px', fontSize: '0.875rem' }}
              />
            </div>
            <div>
              <label className="label-glass" style={{ fontSize: '0.75rem', marginBottom: 6 }}>Amount ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={itemForm.amount}
                onChange={(e) => setItemForm((c) => ({ ...c, amount: e.target.value }))}
                placeholder="0.00"
                className="input-glass"
                style={{ minHeight: 40, padding: '10px 12px', fontSize: '0.875rem' }}
              />
            </div>
          </div>

          <div>
            <label className="label-glass" style={{ fontSize: '0.75rem', marginBottom: 8 }}>Split between</label>
            <div className="new-bill-chips">
              {members.map((m) => {
                const isSelected = itemForm.splitBetween.includes(m.id);
                return (
                  <button
                    type="button"
                    key={m.id}
                    className={`chip-member ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleMember(m.id)}
                  >
                    <span className={`avatar-gradient ${getAvatarColor(m.id)}`} style={{ width: 20, height: 20, fontSize: '0.6rem' }}>
                      {getInitial(m.name)}
                    </span>
                    {m.name}
                    {isSelected && <Check size={12} />}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            className="btn-add-item"
            onClick={addItem}
            disabled={!itemForm.name.trim() || !itemForm.amount || itemForm.splitBetween.length === 0}
          >
            <Plus size={16} />
            Add item to bill
          </button>
        </div>

        {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}

        {items.length > 0 && (
          <>
            <div className="added-items-block">
              <div className="added-items-header">
                <span>{items.length} item{items.length === 1 ? '' : 's'} added</span>
                <span>Total: <strong style={{ color: 'var(--text-muted-3)' }}>{formatMoney(draftTotal)}</strong></span>
              </div>
              <ul className="added-items-list">
                {items.map((item) => (
                  <li key={item.id} className="added-item-row">
                    <div className="added-item-main">
                      <div className="added-item-fields">
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => updateItem(item.id, { name: e.target.value })}
                          className="input-glass added-item-input"
                          placeholder="Item name"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.amount}
                          onChange={(e) => updateItem(item.id, { amount: e.target.value })}
                          className="input-glass added-item-input"
                          placeholder="0.00"
                        />
                      </div>
                      <div className="new-bill-chips added-item-chips">
                        {members.map((member) => {
                          const selected = item.splitBetween.includes(member.id);
                          return (
                            <button
                              type="button"
                              key={`${item.id}-${member.id}`}
                              className={`chip-member chip-member--compact ${selected ? 'selected' : ''}`}
                              onClick={() => toggleItemMember(item.id, member.id)}
                            >
                              <span className={`avatar-gradient ${getAvatarColor(member.id)}`} style={{ width: 16, height: 16, fontSize: '0.55rem' }}>
                                {getInitial(member.name)}
                              </span>
                              {member.name}
                            </button>
                          );
                        })}
                      </div>
                      <div className="added-item-meta">
                        {item.splitBetween.length > 0
                          ? `Split ${item.splitBetween.length > 1 ? `${item.splitBetween.length} ways` : 'with 1 person'}`
                          : 'Pick at least one person'}
                      </div>
                    </div>
                    <button type="button" className="btn-text-danger" onClick={() => removeItem(item.id)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ marginTop: 16 }}>
              <p className="welcome-sub" style={{ marginBottom: 12 }}>
                Who owes what: {members.map((m) => (
                  <span key={m.id} style={{ marginRight: 8 }}>{m.name} {formatMoney(draftTotals[m.id] ?? 0)}</span>
                ))}
              </p>
              <button
                type="button"
                className="btn-save-bill"
                onClick={finalize}
                disabled={saving}
              >
                {saving ? <span className="spinner" /> : `${mode === 'edit' ? 'Save changes' : 'Save bill'}${items.length > 0 ? ` (${formatMoney(draftTotal)})` : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

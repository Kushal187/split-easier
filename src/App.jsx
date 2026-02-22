import { useEffect, useMemo, useState } from 'react';

const STORAGE_BILLS = 'splitWiserBills';
const STORAGE_DRAFT = 'splitWiserDraft';

const PEOPLE = ['Kushal', 'Arjun', 'Ajay', 'Ryan'];

const emptyItem = {
  name: '',
  amount: '',
  splitBetween: []
};

function buildTotals(items) {
  const totals = Object.fromEntries(PEOPLE.map((person) => [person, 0]));

  items.forEach((item) => {
    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount <= 0 || item.splitBetween.length === 0) {
      return;
    }

    const share = amount / item.splitBetween.length;
    item.splitBetween.forEach((person) => {
      totals[person] = (totals[person] ?? 0) + share;
    });
  });

  return totals;
}

/** Per-person breakdown: what each person owes and for which items (name + their share). */
function buildBreakdown(items) {
  const breakdown = Object.fromEntries(PEOPLE.map((person) => [person, []]));

  items.forEach((item) => {
    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount <= 0 || item.splitBetween.length === 0) {
      return;
    }
    const share = amount / item.splitBetween.length;
    item.splitBetween.forEach((person) => {
      if (!breakdown[person]) breakdown[person] = [];
      breakdown[person].push({ name: item.name, share });
    });
  });

  return breakdown;
}

function formatMoney(value) {
  return `$${value.toFixed(2)}`;
}

function getInitial(name) {
  return (name || '?').charAt(0).toUpperCase();
}

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

function loadSavedBills() {
  try {
    const raw = localStorage.getItem(STORAGE_BILLS);
    if (raw == null) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_DRAFT);
    if (raw == null) return null;
    const d = JSON.parse(raw);
    if (d && typeof d.billName === 'string' && Array.isArray(d.items) && d.itemForm && Array.isArray(d.itemForm?.splitBetween)) {
      return { billName: d.billName, items: d.items, itemForm: d.itemForm };
    }
    return null;
  } catch {
    return null;
  }
}

function saveDraft(billName, items, itemForm) {
  try {
    localStorage.setItem(STORAGE_DRAFT, JSON.stringify({ billName, items, itemForm }));
  } catch (_) {}
}

export default function App() {
  const [billName, setBillName] = useState('');
  const [itemForm, setItemForm] = useState(emptyItem);
  const [items, setItems] = useState([]);
  const [savedBills, setSavedBills] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    setSavedBills(loadSavedBills());
    const draft = loadDraft();
    if (draft) {
      setBillName(draft.billName);
      setItems(draft.items);
      setItemForm(draft.itemForm);
    }
  }, []);

  useEffect(() => {
    saveDraft(billName, items, itemForm);
  }, [billName, items, itemForm]);

  const draftTotals = useMemo(() => buildTotals(items), [items]);

  const draftTotal = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [items]
  );

  function togglePerson(person) {
    setItemForm((current) => {
      const inList = current.splitBetween.includes(person);
      const splitBetween = inList
        ? current.splitBetween.filter((name) => name !== person)
        : [...current.splitBetween, person];

      return { ...current, splitBetween };
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

    const nextItem = {
      id: crypto.randomUUID(),
      name: itemForm.name.trim(),
      amount,
      splitBetween: [...itemForm.splitBetween]
    };

    setItems((current) => [...current, nextItem]);
    setItemForm(emptyItem);
    setError('');
  }

  function removeItem(itemId) {
    setItems((current) => current.filter((item) => item.id !== itemId));
  }

  function finalizeBill() {
    if (!billName.trim()) {
      setError('Bill name is required before finalizing.');
      return;
    }

    if (items.length === 0) {
      setError('Add at least one item before finalizing.');
      return;
    }

    const finalized = {
      id: crypto.randomUUID(),
      billName: billName.trim(),
      items,
      totals: buildTotals(items),
      totalAmount: items.reduce((sum, item) => sum + item.amount, 0),
      createdAt: new Date().toLocaleString()
    };

    setSavedBills((prev) => {
      const nextBills = [finalized, ...prev];
      try {
        localStorage.setItem(STORAGE_BILLS, JSON.stringify(nextBills));
        localStorage.removeItem(STORAGE_DRAFT);
      } catch (_) {}
      return nextBills;
    });
    setBillName('');
    setItems([]);
    setItemForm(emptyItem);
    setError('');
  }

  return (
    <main className="app">
      <header className="appHeader">
        <h1 className="appTitle">Split Wiser</h1>
        <p className="appTagline">Split bills with Kushal, Arjun, Ajay & Ryan</p>
      </header>

      <section>
        <h2 className="sectionTitle">This bill</h2>

        <div className="card">
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
              {PEOPLE.map((person) => {
                const isActive = itemForm.splitBetween.includes(person);
                return (
                  <button
                    type="button"
                    key={person}
                    className={`chip ${isActive ? 'active' : ''}`}
                    onClick={() => togglePerson(person)}
                  >
                    {person}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <button type="button" className="btnPrimary" onClick={addItem}>
            Add item to bill
          </button>

          {error && <p className="error">{error}</p>}
        </div>

        <div className="card">
          <h3 className="cardTitle">Items in this bill</h3>
          {items.length === 0 ? (
            <div className="emptyState">
              <ReceiptEmptyIcon />
              <p>No items yet. Add an item above.</p>
            </div>
          ) : (
            <>
              <ul className="itemList">
                {items.map((item) => (
                  <li key={item.id} className="itemRow">
                    <div className="itemInfo">
                      <div className="itemName">{item.name}</div>
                      <div className="itemMeta">Split: {item.splitBetween.join(', ')}</div>
                    </div>
                    <span className="itemAmount">{formatMoney(item.amount)}</span>
                    <button type="button" className="btnGhost" onClick={() => removeItem(item.id)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <p className="subtext">Bill total: <span className="amount">{formatMoney(draftTotal)}</span></p>
            </>
          )}

          <h3 className="cardTitle">Who owes what</h3>
          <div className="owedCard">
            {PEOPLE.map((person) => (
              <div key={person} className="owedRow">
                <span className="personInitial">{getInitial(person)}</span>
                <span className="personName">{person}</span>
                <span className="personAmount">{formatMoney(draftTotals[person] || 0)}</span>
              </div>
            ))}
          </div>

          <div className="summarySticky">
            <button type="button" className="btnPrimary" onClick={finalizeBill} style={{ width: '100%' }}>
              Finalize bill
            </button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="sectionTitle">Past bills</h2>
        <div className="card">
          {savedBills.length === 0 ? (
            <div className="emptyState">
              <ReceiptEmptyIcon />
              <p>No bills yet. Finalize a bill to see it here.</p>
            </div>
          ) : (
            <div className="savedBills">
              {savedBills.map((bill) => {
                const breakdown = buildBreakdown(bill.items || []);
                return (
                  <article key={bill.id} className="savedBill">
                    <h3 className="savedBillTitle">{bill.billName}</h3>
                    <p className="savedBillMeta">{bill.createdAt} · Total {formatMoney(bill.totalAmount)}</p>
                    <div className="owedCard savedBillTotals">
                      {PEOPLE.map((person) => {
                        const total = bill.totals[person] ?? 0;
                        const itemsForPerson = breakdown[person] || [];
                        return (
                          <div key={person} className="owedRow owedRowWithBreakdown">
                            <span className="personInitial">{getInitial(person)}</span>
                            <div className="owedDetail">
                              <span className="personName">{person}</span>
                              {itemsForPerson.length > 0 && (
                                <span className="owedFor">
                                  for: {itemsForPerson.map((e) => `${e.name} (${formatMoney(e.share)})`).join(', ')}
                                </span>
                              )}
                            </div>
                            <span className="personAmount">{formatMoney(total)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

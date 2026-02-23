import { Router } from 'express';
import Bill from '../models/Bill.js';
import Household from '../models/Household.js';
import User from '../models/User.js';
import { splitwiseFetch, withSplitwiseAccessToken } from '../lib/splitwise.js';

const router = Router({ mergeParams: true });

async function ensureMember(req, res, next) {
  const household = await Household.findById(req.params.householdId);
  if (!household) {
    return res.status(404).json({ error: 'Household not found' });
  }
  const isMember = household.memberIds.some((id) => id.toString() === req.user.id);
  if (!isMember) {
    return res.status(403).json({ error: 'Not a member of this household' });
  }
  req.household = household;
  next();
}

function buildTotals(items) {
  const totals = {};
  items.forEach((item) => {
    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !item.splitBetween?.length) return;
    const share = amount / item.splitBetween.length;
    item.splitBetween.forEach((userId) => {
      const key = userId.toString();
      totals[key] = (totals[key] ?? 0) + share;
    });
  });
  return totals;
}

function normalizeItems(rawItems, allowedMemberIds) {
  return rawItems.map((item) => {
    const splitBetween = (item.splitBetween || []).filter((id) => allowedMemberIds.includes(id.toString()));
    return {
      id: item.id || crypto.randomUUID(),
      name: item.name?.trim() ?? '',
      amount: Number(item.amount) || 0,
      splitBetween: splitBetween.map((id) => (typeof id === 'string' ? id : id.toString()))
    };
  });
}

function formatMoney(value) {
  return (Math.round(Number(value) * 100) / 100).toFixed(2);
}

function parseSplitwiseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000;
    const dt = new Date(ms);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const numeric = Number(value.trim());
    const ms = numeric > 1e12 ? numeric : numeric * 1000;
    const dt = new Date(ms);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function firstExpenseFromSplitwiseResult(result) {
  if (result?.expense && typeof result.expense === 'object') return result.expense;
  if (Array.isArray(result?.expenses) && result.expenses.length > 0) return result.expenses[0];
  return null;
}

function billSortTimestamp(billDoc) {
  const remoteUpdated = parseSplitwiseDate(billDoc?.splitwiseSync?.expenseUpdatedAt);
  if (remoteUpdated) return remoteUpdated.getTime();

  const updatedAt = parseSplitwiseDate(billDoc?.updatedAt);
  if (updatedAt) return updatedAt.getTime();

  const createdAt = parseSplitwiseDate(billDoc?.createdAt);
  return createdAt ? createdAt.getTime() : 0;
}

function billResponse(billDoc, nameMap = {}) {
  return {
    id: billDoc._id.toString(),
    billName: billDoc.billName,
    items: billDoc.items,
    totals: billDoc.totals,
    totalAmount: billDoc.totalAmount,
    createdBy: billDoc.createdBy.toString(),
    createdAt: billDoc.createdAt,
    memberNames: nameMap,
    splitwiseSync: {
      status: billDoc?.splitwiseSync?.status || 'pending',
      expenseId: billDoc?.splitwiseSync?.expenseId || null,
      syncedAt: billDoc?.splitwiseSync?.syncedAt || null,
      lastAttemptAt: billDoc?.splitwiseSync?.lastAttemptAt || null,
      error: billDoc?.splitwiseSync?.error || null,
      expenseUpdatedAt: billDoc?.splitwiseSync?.expenseUpdatedAt || null,
      lastLocalEditAt: billDoc?.splitwiseSync?.lastLocalEditAt || null,
      lastSyncDirection: billDoc?.splitwiseSync?.lastSyncDirection || null,
      conflict: Boolean(billDoc?.splitwiseSync?.conflict)
    }
  };
}

function buildSplitwiseDetails(items, memberNameById = {}) {
  const lines = items.slice(0, 25).map((item) => {
    const people = (item.splitBetween || [])
      .map((id) => memberNameById[id?.toString?.() || String(id)] || String(id))
      .join(', ');
    return `${item.name}: ${formatMoney(item.amount)} (${people || 'unassigned'})`;
  });
  return `SplitEasier itemized bill\n${lines.join('\n')}`;
}

function buildSplitwisePayload({ bill, household, actorUserId, users }) {
  const totalCost = Number(bill.totalAmount || 0);
  if (!Number.isFinite(totalCost) || totalCost <= 0) {
    const err = new Error('Invalid total amount for Splitwise sync');
    err.status = 400;
    throw err;
  }

  const totals = bill.totals || {};
  const participantIds = [...new Set(Object.keys(totals).concat([actorUserId]))];
  const memberNameById = Object.fromEntries(users.map((u) => [u._id.toString(), u.name || u._id.toString()]));
  const splitwiseByLocal = new Map(users.map((u) => [u._id.toString(), u.splitwise?.id ? String(u.splitwise.id) : null]));

  const missing = participantIds.filter((id) => !splitwiseByLocal.get(id));
  if (missing.length > 0) {
    const missingUsers = users.filter((u) => missing.includes(u._id.toString())).map((u) => u.name || u._id.toString());
    const err = new Error(`Cannot sync. Members missing Splitwise link: ${missingUsers.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const totalCents = Math.round(totalCost * 100);
  const owedCentsByUser = {};
  let sumOwed = 0;
  participantIds.forEach((userId) => {
    const owed = Math.round((Number(totals[userId] || 0) || 0) * 100);
    owedCentsByUser[userId] = owed;
    sumOwed += owed;
  });
  const diff = totalCents - sumOwed;
  owedCentsByUser[actorUserId] = (owedCentsByUser[actorUserId] || 0) + diff;

  const payload = {
    group_id: String(household.splitwiseGroupId),
    description: bill.billName,
    cost: formatMoney(totalCost),
    currency_code: 'USD',
    details: buildSplitwiseDetails(bill.items || [], memberNameById)
  };

  participantIds.forEach((userId, idx) => {
    payload[`users__${idx}__user_id`] = splitwiseByLocal.get(userId);
    payload[`users__${idx}__owed_share`] = formatMoney((owedCentsByUser[userId] || 0) / 100);
    payload[`users__${idx}__paid_share`] = formatMoney(userId === actorUserId ? totalCost : 0);
  });

  return payload;
}

async function syncBillToSplitwise({ bill, household, actorUserId }) {
  const previous = bill?.splitwiseSync || {};
  if (!household.splitwiseGroupId) {
    bill.splitwiseSync = {
      status: 'skipped',
      expenseId: null,
      syncedAt: null,
      lastAttemptAt: new Date(),
      error: 'Household is not linked to a Splitwise group',
      expenseUpdatedAt: null,
      lastLocalEditAt: previous.lastLocalEditAt || new Date(),
      lastSyncDirection: 'push',
      conflict: false
    };
    await bill.save();
    return;
  }

  let payload;
  try {
    const totals = bill.totals || {};
    const participantIds = [...new Set(Object.keys(totals).concat([actorUserId]))];
    const users = await User.find({ _id: { $in: participantIds } }).select('name splitwise');
    payload = buildSplitwisePayload({ bill, household, actorUserId, users });
  } catch (err) {
    bill.splitwiseSync = {
      status: 'failed',
      expenseId: previous.expenseId || null,
      syncedAt: previous.syncedAt || null,
      lastAttemptAt: new Date(),
      error: err.message || 'Splitwise payload build failed',
      expenseUpdatedAt: previous.expenseUpdatedAt || null,
      lastLocalEditAt: previous.lastLocalEditAt || new Date(),
      lastSyncDirection: 'push',
      conflict: false
    };
    await bill.save();
    return;
  }

  try {
    const result = await withSplitwiseAccessToken(actorUserId, (accessToken) =>
      splitwiseFetch('/create_expense', accessToken, { method: 'POST', body: payload })
    );

    const firstExpense = firstExpenseFromSplitwiseResult(result);
    const expenseId = firstExpense?.id || result?.expense_id || null;
    const remoteUpdatedAt = parseSplitwiseDate(firstExpense?.updated_at) || new Date();

    bill.splitwiseSync = {
      status: 'synced',
      expenseId: expenseId ? String(expenseId) : null,
      syncedAt: new Date(),
      lastAttemptAt: new Date(),
      error: null,
      expenseUpdatedAt: remoteUpdatedAt,
      lastLocalEditAt: previous.lastLocalEditAt || new Date(),
      lastSyncDirection: 'push',
      conflict: false
    };
    await bill.save();
  } catch (err) {
    bill.splitwiseSync = {
      status: 'failed',
      expenseId: previous.expenseId || null,
      syncedAt: previous.syncedAt || null,
      lastAttemptAt: new Date(),
      error: err.message || 'Splitwise sync failed',
      expenseUpdatedAt: previous.expenseUpdatedAt || null,
      lastLocalEditAt: previous.lastLocalEditAt || new Date(),
      lastSyncDirection: 'push',
      conflict: false
    };
    await bill.save();
  }
}

async function updateBillOnSplitwise({ bill, household, actorUserId }) {
  const previous = bill?.splitwiseSync || {};
  if (!household.splitwiseGroupId || !bill?.splitwiseSync?.expenseId) {
    await syncBillToSplitwise({ bill, household, actorUserId });
    return bill?.splitwiseSync?.status === 'synced';
  }

  try {
    const totals = bill.totals || {};
    const participantIds = [...new Set(Object.keys(totals).concat([actorUserId]))];
    const users = await User.find({ _id: { $in: participantIds } }).select('name splitwise');
    const payload = buildSplitwisePayload({ bill, household, actorUserId, users });

    const result = await withSplitwiseAccessToken(actorUserId, (accessToken) =>
      splitwiseFetch(`/update_expense/${bill.splitwiseSync.expenseId}`, accessToken, { method: 'POST', body: payload })
    );
    const hasErrors = Array.isArray(result?.errors) && result.errors.length > 0;
    if (hasErrors) {
      throw new Error(result.errors[0] || 'Splitwise update failed');
    }
    const firstExpense = firstExpenseFromSplitwiseResult(result);
    const remoteUpdatedAt = parseSplitwiseDate(firstExpense?.updated_at) || new Date();

    bill.splitwiseSync = {
      status: 'synced',
      expenseId: bill.splitwiseSync.expenseId,
      syncedAt: new Date(),
      lastAttemptAt: new Date(),
      error: null,
      expenseUpdatedAt: remoteUpdatedAt,
      lastLocalEditAt: previous.lastLocalEditAt || new Date(),
      lastSyncDirection: 'push',
      conflict: false
    };
    await bill.save();
    return true;
  } catch (err) {
    bill.splitwiseSync = {
      status: 'failed',
      expenseId: previous.expenseId || null,
      syncedAt: previous.syncedAt || null,
      lastAttemptAt: new Date(),
      error: err.message || 'Splitwise update failed',
      expenseUpdatedAt: previous.expenseUpdatedAt || null,
      lastLocalEditAt: previous.lastLocalEditAt || new Date(),
      lastSyncDirection: 'push',
      conflict: false
    };
    await bill.save();
    return false;
  }
}

router.use(ensureMember);

router.get('/', async (req, res, next) => {
  try {
    const bills = await Bill.find({ householdId: req.params.householdId }).lean();
    bills.sort((a, b) => {
      const tsDiff = billSortTimestamp(b) - billSortTimestamp(a);
      if (tsDiff !== 0) return tsDiff;
      return (parseSplitwiseDate(b?.createdAt)?.getTime() || 0) - (parseSplitwiseDate(a?.createdAt)?.getTime() || 0);
    });
    const memberIds = [...new Set(bills.flatMap((b) => Object.keys(b.totals || {})))];
    const users = await User.find({ _id: { $in: memberIds } }).select('name').lean();
    const nameMap = Object.fromEntries(users.map((u) => [u._id.toString(), u.name]));

    res.json(bills.map((b) => billResponse(b, nameMap)));
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { billName, items } = req.body;
    if (!billName?.trim()) {
      return res.status(400).json({ error: 'Bill name is required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    const memberIds = req.household.memberIds.map((id) => id.toString());
    const normalizedItems = normalizeItems(items, memberIds);

    const totalAmount = normalizedItems.reduce((sum, i) => sum + i.amount, 0);
    const totals = buildTotals(normalizedItems);

    const bill = await Bill.create({
      householdId: req.params.householdId,
      billName: billName.trim(),
      items: normalizedItems,
      totals,
      totalAmount,
      createdBy: req.user.id,
      splitwiseSync: {
        status: 'pending',
        expenseId: null,
        syncedAt: null,
        lastAttemptAt: null,
        error: null,
        expenseUpdatedAt: null,
        lastLocalEditAt: new Date(),
        lastSyncDirection: 'push',
        conflict: false
      }
    });

    await syncBillToSplitwise({ bill, household: req.household, actorUserId: req.user.id });

    const users = await User.find({ _id: { $in: Object.keys(totals) } }).select('name').lean();
    const nameMap = Object.fromEntries(users.map((u) => [u._id.toString(), u.name]));

    const updatedBill = await Bill.findById(bill._id).lean();
    res.status(201).json(billResponse(updatedBill, nameMap));
  } catch (e) {
    next(e);
  }
});

router.get('/:billId', async (req, res, next) => {
  try {
    const bill = await Bill.findOne({
      _id: req.params.billId,
      householdId: req.params.householdId
    }).lean();
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }
    const memberIds = [
      ...new Set(Object.keys(bill.totals || {}).concat(bill.items?.flatMap((i) => i.splitBetween || []) || []))
    ];
    const users = await User.find({ _id: { $in: memberIds } }).select('name').lean();
    const nameMap = Object.fromEntries(users.map((u) => [u._id.toString(), u.name]));

    res.json(billResponse(bill, nameMap));
  } catch (e) {
    next(e);
  }
});

router.patch('/:billId', async (req, res, next) => {
  try {
    const { billName, items } = req.body;
    const bill = await Bill.findOne({
      _id: req.params.billId,
      householdId: req.params.householdId
    });
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }
    if (bill.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the bill creator can edit this bill' });
    }

    if (!billName?.trim()) {
      return res.status(400).json({ error: 'Bill name is required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    const memberIds = req.household.memberIds.map((id) => id.toString());
    const normalizedItems = normalizeItems(items, memberIds);
    const totalAmount = normalizedItems.reduce((sum, i) => sum + i.amount, 0);
    const totals = buildTotals(normalizedItems);

    bill.billName = billName.trim();
    bill.items = normalizedItems;
    bill.totals = totals;
    bill.totalAmount = totalAmount;
    bill.splitwiseSync = {
      ...(bill.splitwiseSync || {}),
      lastLocalEditAt: new Date(),
      lastSyncDirection: 'push',
      conflict: false
    };
    await bill.save();
    await updateBillOnSplitwise({ bill, household: req.household, actorUserId: req.user.id });

    const users = await User.find({ _id: { $in: Object.keys(totals) } }).select('name').lean();
    const nameMap = Object.fromEntries(users.map((u) => [u._id.toString(), u.name]));
    res.json(billResponse(bill, nameMap));
  } catch (e) {
    next(e);
  }
});

router.delete('/:billId', async (req, res, next) => {
  try {
    const bill = await Bill.findOne({
      _id: req.params.billId,
      householdId: req.params.householdId
    });
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }
    if (bill.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the bill creator can delete this bill' });
    }

    const splitwiseExpenseId = bill?.splitwiseSync?.expenseId || null;
    if (splitwiseExpenseId) {
      const result = await withSplitwiseAccessToken(req.user.id, (accessToken) =>
        splitwiseFetch(`/delete_expense/${splitwiseExpenseId}`, accessToken, { method: 'POST' })
      );
      if (!result?.success) {
        return res.status(502).json({ error: 'Failed to delete expense on Splitwise' });
      }
    }
    await Bill.deleteOne({ _id: bill._id });

    res.json({
      ok: true,
      warning: null
    });
  } catch (e) {
    next(e);
  }
});

export default router;

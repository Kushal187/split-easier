import { Router } from 'express';
import Bill from '../models/Bill.js';
import Household from '../models/Household.js';
import User from '../models/User.js';

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

router.use(ensureMember);

router.get('/', async (req, res, next) => {
  try {
    const bills = await Bill.find({ householdId: req.params.householdId })
      .sort({ createdAt: -1 })
      .lean();
    const memberIds = [...new Set(bills.flatMap((b) => Object.keys(b.totals || {})))];
    const users = await User.find({ _id: { $in: memberIds } }).select('name').lean();
    const nameMap = Object.fromEntries(users.map((u) => [u._id.toString(), u.name]));

    res.json(
      bills.map((b) => ({
        id: b._id.toString(),
        billName: b.billName,
        items: b.items,
        totals: b.totals,
        totalAmount: b.totalAmount,
        createdBy: b.createdBy.toString(),
        createdAt: b.createdAt,
        memberNames: nameMap
      }))
    );
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
    const normalizedItems = items.map((item) => {
      const splitBetween = (item.splitBetween || []).filter((id) => memberIds.includes(id.toString()));
      return {
        id: item.id || crypto.randomUUID(),
        name: item.name?.trim() ?? '',
        amount: Number(item.amount) || 0,
        splitBetween: splitBetween.map((id) => (typeof id === 'string' ? id : id.toString()))
      };
    });
    const totalAmount = normalizedItems.reduce((sum, i) => sum + i.amount, 0);
    const totals = buildTotals(normalizedItems);

    const bill = await Bill.create({
      householdId: req.params.householdId,
      billName: billName.trim(),
      items: normalizedItems,
      totals,
      totalAmount,
      createdBy: req.user.id
    });

    const users = await User.find({ _id: { $in: Object.keys(totals) } }).select('name').lean();
    const nameMap = Object.fromEntries(users.map((u) => [u._id.toString(), u.name]));

    res.status(201).json({
      id: bill._id.toString(),
      billName: bill.billName,
      items: bill.items,
      totals: bill.totals,
      totalAmount: bill.totalAmount,
      createdBy: bill.createdBy.toString(),
      createdAt: bill.createdAt,
      memberNames: nameMap
    });
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
    const memberIds = [...new Set(Object.keys(bill.totals || {}).concat(bill.items?.flatMap((i) => i.splitBetween || []) || []))];
    const users = await User.find({ _id: { $in: memberIds } }).select('name').lean();
    const nameMap = Object.fromEntries(users.map((u) => [u._id.toString(), u.name]));

    res.json({
      id: bill._id.toString(),
      billName: bill.billName,
      items: bill.items,
      totals: bill.totals,
      totalAmount: bill.totalAmount,
      createdBy: bill.createdBy.toString(),
      createdAt: bill.createdAt,
      memberNames: nameMap
    });
  } catch (e) {
    next(e);
  }
});

export default router;

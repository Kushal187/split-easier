import { Router } from 'express';
import Household from '../models/Household.js';
import Bill from '../models/Bill.js';
import User from '../models/User.js';
import { splitwiseFetch, withSplitwiseAccessToken } from '../lib/splitwise.js';

const router = Router();

function serializeHousehold(h) {
  return {
    id: h._id.toString(),
    name: h.name,
    ownerId: h.ownerId._id.toString(),
    ownerName: h.ownerId.name,
    memberIds: h.memberIds.map((m) => m._id.toString()),
    members: h.memberIds.map((m) => ({ id: m._id.toString(), name: m.name, email: m.email })),
    splitwiseGroupId: h.splitwiseGroupId || null,
    splitwiseGroupName: h.splitwiseGroupName || null,
    createdAt: h.createdAt
  };
}

async function loadHouseholdForResponse(householdId) {
  return Household.findById(householdId)
    .populate('ownerId', 'name email')
    .populate('memberIds', 'name email')
    .lean();
}

function splitwiseMemberName(member) {
  const first = member?.first_name?.trim();
  const last = member?.last_name?.trim();
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (member?.email?.trim()) return member.email.trim();
  return `Splitwise User ${member?.id || ''}`.trim();
}

function parseSplitwiseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000;
    const dt = new Date(ms);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (typeof value === 'string' && value.trim()) {
    if (/^\d+$/.test(value.trim())) {
      const numeric = Number(value.trim());
      const ms = numeric > 1e12 ? numeric : numeric * 1000;
      const dt = new Date(ms);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

function parseMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric * 100) / 100);
}

function normalizeTotals(totals) {
  const normalized = {};
  Object.entries(totals || {}).forEach(([userId, amount]) => {
    normalized[userId] = Math.round(Number(amount || 0) * 100) / 100;
  });
  return normalized;
}

function isSplitwisePayment(expense) {
  return expense?.payment === true;
}

function projectSplitwiseExpenseToLocalBill({
  expense,
  localBySplitwiseId,
  allowedMemberIds,
  fallbackCreatorId,
  requiredParticipantId
}) {
  const splitwiseExpenseId = expense?.id ? String(expense.id) : null;
  if (!splitwiseExpenseId) return null;

  const userRows = Array.isArray(expense?.users) ? expense.users : [];
  const shares = [];
  for (const row of userRows) {
    const splitwiseUserIdRaw = row?.user_id || row?.user?.id || null;
    const splitwiseUserId = splitwiseUserIdRaw ? String(splitwiseUserIdRaw) : null;
    if (!splitwiseUserId) continue;
    const localUser = localBySplitwiseId.get(splitwiseUserId);
    if (!localUser) continue;
    const localUserId = localUser._id.toString();
    if (!allowedMemberIds.has(localUserId)) continue;
    shares.push({
      localUserId,
      localUserName: localUser.name || localUserId,
      owed: parseMoney(row?.owed_share),
      paid: parseMoney(row?.paid_share)
    });
  }
  if (shares.length === 0) return null;
  if (requiredParticipantId && !shares.some((share) => share.localUserId === requiredParticipantId)) {
    return null;
  }

  const totals = {};
  shares.forEach((share) => {
    totals[share.localUserId] = (totals[share.localUserId] || 0) + share.owed;
  });

  let totalAmount = parseMoney(expense?.cost);
  const owedSum = shares.reduce((sum, share) => sum + share.owed, 0);
  if (totalAmount <= 0) totalAmount = Math.round(owedSum * 100) / 100;
  if (totalAmount <= 0) return null;

  const sortedByPaid = [...shares].sort((a, b) => b.paid - a.paid);
  const topPayer = sortedByPaid[0]?.localUserId || fallbackCreatorId;
  const createdBy = allowedMemberIds.has(topPayer) ? topPayer : fallbackCreatorId;

  const items = shares
    .filter((share) => share.owed > 0)
    .map((share) => ({
      id: crypto.randomUUID(),
      name: `Splitwise share - ${share.localUserName}`,
      amount: share.owed,
      splitBetween: [share.localUserId]
    }));

  if (items.length === 0) {
    items.push({
      id: crypto.randomUUID(),
      name: 'Splitwise imported amount',
      amount: totalAmount,
      splitBetween: [createdBy]
    });
    totals[createdBy] = Math.round(totalAmount * 100) / 100;
  }

  return {
    billName: expense?.description?.trim() || `Splitwise Expense ${splitwiseExpenseId}`,
    createdBy,
    totalAmount: Math.round(totalAmount * 100) / 100,
    totals: normalizeTotals(totals),
    items
  };
}

async function upsertLocalUserFromSplitwiseMember(member) {
  const splitwiseId = member?.id ? String(member.id) : null;
  const email = member?.email?.trim()?.toLowerCase() || null;

  let user = null;
  if (splitwiseId) {
    user = await User.findOne({ 'splitwise.id': splitwiseId });
  }
  if (!user && email) {
    user = await User.findOne({ email });
  }

  const nextName = splitwiseMemberName(member);

  if (!user) {
    user = await User.create({
      email: email || `splitwise_member_${splitwiseId || crypto.randomUUID()}@local.invalid`,
      passwordHash: null,
      name: nextName,
      splitwise: splitwiseId
        ? {
            id: splitwiseId,
            accessToken: null,
            refreshToken: null,
            tokenType: null,
            expiresAt: null
          }
        : undefined
    });
    return user;
  }

  if (!user.name?.trim()) user.name = nextName;
  if (email && user.email.endsWith('@local.invalid')) user.email = email;
  if (splitwiseId && !user?.splitwise?.id) user.splitwise = { ...(user.splitwise || {}), id: splitwiseId };
  await user.save();
  return user;
}

router.get('/', async (req, res, next) => {
  try {
    const households = await Household.find({ memberIds: req.user.id })
      .populate('ownerId', 'name email')
      .populate('memberIds', 'name email')
      .sort({ updatedAt: -1 })
      .lean();
    res.json(households.map(serializeHousehold));
  } catch (e) {
    next(e);
  }
});

router.post('/import-splitwise', async (req, res, next) => {
  try {
    const groupsData = await withSplitwiseAccessToken(req.user.id, (accessToken) => splitwiseFetch('/get_groups', accessToken));
    const groups = Array.isArray(groupsData?.groups) ? groupsData.groups : [];

    const imported = [];
    for (const group of groups) {
      const groupId = group?.id ? String(group.id) : null;
      if (!groupId) continue;

      const rawMembers = Array.isArray(group?.members) ? group.members : [];
      const localMembers = [];
      for (const member of rawMembers) {
        const localUser = await upsertLocalUserFromSplitwiseMember(member);
        localMembers.push(localUser._id);
      }

      const dedupMemberIds = [...new Set(localMembers.map((id) => id.toString()))];
      if (!dedupMemberIds.includes(req.user.id)) dedupMemberIds.push(req.user.id);

      let household = await Household.findOne({ splitwiseGroupId: groupId });
      if (!household) {
        household = await Household.create({
          name: group?.name?.trim() || `Splitwise Group ${groupId}`,
          ownerId: req.user.id,
          memberIds: dedupMemberIds,
          splitwiseGroupId: groupId,
          splitwiseGroupName: group?.name?.trim() || null
        });
      } else {
        household.name = group?.name?.trim() || household.name;
        household.memberIds = dedupMemberIds;
        household.splitwiseGroupName = group?.name?.trim() || household.splitwiseGroupName;
        await household.save();
      }

      const populated = await loadHouseholdForResponse(household._id);
      imported.push(serializeHousehold(populated));
    }

    res.json({ importedCount: imported.length, households: imported });
  } catch (e) {
    if (e.status === 400) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
});

router.post('/:id/sync-splitwise', async (req, res, next) => {
  try {
    const household = await Household.findById(req.params.id);
    if (!household) {
      return res.status(404).json({ error: 'Household not found' });
    }
    if (!household.memberIds.some((id) => id.toString() === req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this household' });
    }
    if (!household.splitwiseGroupId) {
      return res.status(400).json({ error: 'Household is not linked to a Splitwise group' });
    }

    const memberUsers = await User.find({ _id: { $in: household.memberIds } }).select('_id name splitwise');
    const localBySplitwiseId = new Map();
    memberUsers.forEach((userDoc) => {
      const splitwiseId = userDoc?.splitwise?.id ? String(userDoc.splitwise.id) : null;
      if (splitwiseId) localBySplitwiseId.set(splitwiseId, userDoc);
    });
    const allowedMemberIds = new Set(household.memberIds.map((id) => id.toString()));

    const sinceDate = parseSplitwiseDate(household.splitwiseLastCursor);
    const summary = {
      fetched: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      conflicts: 0,
      skipped: 0
    };

    let newestRemoteUpdate = sinceDate;
    let offset = 0;
    const pageSize = 100;
    const maxPages = 20;

    for (let page = 0; page < maxPages; page += 1) {
      const query = {
        group_id: household.splitwiseGroupId,
        limit: pageSize,
        offset
      };
      if (sinceDate) {
        query.updated_after = Math.floor(sinceDate.getTime() / 1000);
      }

      const data = await withSplitwiseAccessToken(req.user.id, (accessToken) =>
        splitwiseFetch('/get_expenses', accessToken, { query })
      );
      const expenses = Array.isArray(data?.expenses) ? data.expenses : [];
      summary.fetched += expenses.length;
      if (expenses.length === 0) break;

      for (const expense of expenses) {
        const expenseId = expense?.id ? String(expense.id) : null;
        if (!expenseId) {
          summary.skipped += 1;
          continue;
        }

        const remoteUpdatedAt = parseSplitwiseDate(expense?.updated_at) || new Date();
        if (!newestRemoteUpdate || remoteUpdatedAt > newestRemoteUpdate) {
          newestRemoteUpdate = remoteUpdatedAt;
        }

        const existingBill = await Bill.findOne({
          householdId: household._id,
          'splitwiseSync.expenseId': expenseId
        });

        if (expense?.deleted_at) {
          if (existingBill) {
            await Bill.deleteOne({ _id: existingBill._id });
            summary.deleted += 1;
          } else {
            summary.skipped += 1;
          }
          continue;
        }
        if (isSplitwisePayment(expense)) {
          summary.skipped += 1;
          continue;
        }

        const projected = projectSplitwiseExpenseToLocalBill({
          expense,
          localBySplitwiseId,
          allowedMemberIds,
          fallbackCreatorId: req.user.id,
          requiredParticipantId: req.user.id
        });
        if (!projected) {
          summary.skipped += 1;
          continue;
        }

        if (existingBill) {
          const knownRemoteUpdatedAt = parseSplitwiseDate(existingBill?.splitwiseSync?.expenseUpdatedAt);
          const localLastEditAt = parseSplitwiseDate(existingBill?.splitwiseSync?.lastLocalEditAt);
          const lastSyncedAt = parseSplitwiseDate(existingBill?.splitwiseSync?.syncedAt);
          const remoteChanged = !knownRemoteUpdatedAt || remoteUpdatedAt > knownRemoteUpdatedAt;
          const localChangedSinceLastSync = Boolean(localLastEditAt && lastSyncedAt && localLastEditAt > lastSyncedAt);

          if (localChangedSinceLastSync && remoteChanged) {
            existingBill.splitwiseSync = {
              ...(existingBill.splitwiseSync || {}),
              status: 'failed',
              expenseId,
              lastAttemptAt: new Date(),
              error: 'Conflict detected: local and Splitwise both changed since last sync',
              expenseUpdatedAt: remoteUpdatedAt,
              lastSyncDirection: 'pull',
              conflict: true
            };
            await existingBill.save();
            summary.conflicts += 1;
            continue;
          }

          if (!remoteChanged) {
            summary.skipped += 1;
            continue;
          }

          existingBill.billName = projected.billName;
          existingBill.items = projected.items;
          existingBill.totals = projected.totals;
          existingBill.totalAmount = projected.totalAmount;
          existingBill.splitwiseSync = {
            ...(existingBill.splitwiseSync || {}),
            status: 'synced',
            expenseId,
            syncedAt: new Date(),
            lastAttemptAt: new Date(),
            error: null,
            expenseUpdatedAt: remoteUpdatedAt,
            lastSyncDirection: 'pull',
            conflict: false
          };
          await existingBill.save();
          summary.updated += 1;
          continue;
        }

        await Bill.create({
          householdId: household._id,
          billName: projected.billName,
          items: projected.items,
          totals: projected.totals,
          totalAmount: projected.totalAmount,
          createdBy: projected.createdBy,
          splitwiseSync: {
            status: 'synced',
            expenseId,
            syncedAt: new Date(),
            lastAttemptAt: new Date(),
            error: null,
            expenseUpdatedAt: remoteUpdatedAt,
            lastLocalEditAt: null,
            lastSyncDirection: 'pull',
            conflict: false
          }
        });
        summary.created += 1;
      }

      if (expenses.length < pageSize) break;
      offset += pageSize;
    }

    household.splitwiseLastPulledAt = new Date();
    if (newestRemoteUpdate) {
      household.splitwiseLastCursor = newestRemoteUpdate.toISOString();
    }
    await household.save();

    return res.json({ ok: true, summary });
  } catch (e) {
    if (e.status === 400) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, splitwiseGroupId, splitwiseGroupName } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ error: 'Household name is required' });
    }
    const household = await Household.create({
      name: name.trim(),
      ownerId: req.user.id,
      memberIds: [req.user.id],
      splitwiseGroupId: splitwiseGroupId ? String(splitwiseGroupId) : null,
      splitwiseGroupName: splitwiseGroupName?.trim() || null
    });
    const populated = await loadHouseholdForResponse(household._id);
    res.status(201).json(serializeHousehold(populated));
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const household = await loadHouseholdForResponse(req.params.id);
    if (!household) {
      return res.status(404).json({ error: 'Household not found' });
    }
    const memberIds = household.memberIds.map((m) => m._id.toString());
    if (!memberIds.includes(req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this household' });
    }
    res.json(serializeHousehold(household));
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const household = await Household.findById(req.params.id);
    if (!household) {
      return res.status(404).json({ error: 'Household not found' });
    }
    if (!household.memberIds.some((id) => id.toString() === req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this household' });
    }
    if (household.ownerId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the owner can update the household' });
    }
    if (req.body.name?.trim()) {
      household.name = req.body.name.trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'splitwiseGroupId')) {
      household.splitwiseGroupId = req.body.splitwiseGroupId ? String(req.body.splitwiseGroupId) : null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'splitwiseGroupName')) {
      household.splitwiseGroupName = req.body.splitwiseGroupName?.trim() || null;
    }
    await household.save();

    const populated = await loadHouseholdForResponse(household._id);
    res.json(serializeHousehold(populated));
  } catch (e) {
    next(e);
  }
});

router.post('/:id/members', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email?.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const household = await Household.findById(req.params.id);
    if (!household) {
      return res.status(404).json({ error: 'Household not found' });
    }
    if (household.ownerId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the owner can add members' });
    }
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'No user found with this email' });
    }
    const userIdStr = user._id.toString();
    if (household.memberIds.some((id) => id.toString() === userIdStr)) {
      return res.status(409).json({ error: 'User is already a member' });
    }
    household.memberIds.push(user._id);
    await household.save();
    const populated = await loadHouseholdForResponse(household._id);
    res.json(serializeHousehold(populated));
  } catch (e) {
    next(e);
  }
});

router.delete('/:id/members/:userId', async (req, res, next) => {
  try {
    const { id: householdId, userId } = req.params;
    const household = await Household.findById(householdId);
    if (!household) {
      return res.status(404).json({ error: 'Household not found' });
    }
    const isOwner = household.ownerId.toString() === req.user.id;
    const isSelf = userId === req.user.id;
    if (!isOwner && !isSelf) {
      return res.status(403).json({ error: 'Only the owner or the member themselves can remove' });
    }
    if (isSelf && isOwner) {
      return res.status(400).json({ error: 'Owner cannot remove themselves; transfer ownership or delete the household' });
    }
    household.memberIds = household.memberIds.filter((id) => id.toString() !== userId);
    await household.save();
    const populated = await loadHouseholdForResponse(household._id);
    res.json(serializeHousehold(populated));
  } catch (e) {
    next(e);
  }
});

export default router;

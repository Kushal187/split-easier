import { Router } from 'express';
import Household from '../models/Household.js';
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

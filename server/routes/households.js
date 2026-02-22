import { Router } from 'express';
import Household from '../models/Household.js';
import User from '../models/User.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const households = await Household.find({ memberIds: req.user.id })
      .populate('ownerId', 'name email')
      .populate('memberIds', 'name email')
      .sort({ updatedAt: -1 })
      .lean();
    res.json(
      households.map((h) => ({
        id: h._id.toString(),
        name: h.name,
        ownerId: h.ownerId._id.toString(),
        ownerName: h.ownerId.name,
        memberIds: h.memberIds.map((m) => m._id.toString()),
        members: h.memberIds.map((m) => ({ id: m._id.toString(), name: m.name, email: m.email })),
        createdAt: h.createdAt
      }))
    );
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ error: 'Household name is required' });
    }
    const household = await Household.create({
      name: name.trim(),
      ownerId: req.user.id,
      memberIds: [req.user.id]
    });
    const populated = await Household.findById(household._id)
      .populate('ownerId', 'name email')
      .populate('memberIds', 'name email')
      .lean();
    res.status(201).json({
      id: populated._id.toString(),
      name: populated.name,
      ownerId: populated.ownerId._id.toString(),
      ownerName: populated.ownerId.name,
      memberIds: populated.memberIds.map((m) => m._id.toString()),
      members: populated.memberIds.map((m) => ({ id: m._id.toString(), name: m.name, email: m.email })),
      createdAt: populated.createdAt
    });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const household = await Household.findById(req.params.id)
      .populate('ownerId', 'name email')
      .populate('memberIds', 'name email')
      .lean();
    if (!household) {
      return res.status(404).json({ error: 'Household not found' });
    }
    const memberIds = household.memberIds.map((m) => m._id.toString());
    if (!memberIds.includes(req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this household' });
    }
    res.json({
      id: household._id.toString(),
      name: household.name,
      ownerId: household.ownerId._id.toString(),
      ownerName: household.ownerId.name,
      memberIds,
      members: household.memberIds.map((m) => ({ id: m._id.toString(), name: m.name, email: m.email })),
      createdAt: household.createdAt
    });
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
      await household.save();
    }
    const populated = await Household.findById(household._id)
      .populate('ownerId', 'name email')
      .populate('memberIds', 'name email')
      .lean();
    res.json({
      id: populated._id.toString(),
      name: populated.name,
      ownerId: populated.ownerId._id.toString(),
      ownerName: populated.ownerId.name,
      memberIds: populated.memberIds.map((m) => m._id.toString()),
      members: populated.memberIds.map((m) => ({ id: m._id.toString(), name: m.name, email: m.email })),
      createdAt: populated.createdAt
    });
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
    const populated = await Household.findById(household._id)
      .populate('ownerId', 'name email')
      .populate('memberIds', 'name email')
      .lean();
    res.json({
      id: populated._id.toString(),
      name: populated.name,
      ownerId: populated.ownerId._id.toString(),
      ownerName: populated.ownerId.name,
      memberIds: populated.memberIds.map((m) => m._id.toString()),
      members: populated.memberIds.map((m) => ({ id: m._id.toString(), name: m.name, email: m.email })),
      createdAt: populated.createdAt
    });
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
    const populated = await Household.findById(household._id)
      .populate('ownerId', 'name email')
      .populate('memberIds', 'name email')
      .lean();
    res.json({
      id: populated._id.toString(),
      name: populated.name,
      ownerId: populated.ownerId._id.toString(),
      ownerName: populated.ownerId.name,
      memberIds: populated.memberIds.map((m) => m._id.toString()),
      members: populated.memberIds.map((m) => ({ id: m._id.toString(), name: m.name, email: m.email })),
      createdAt: populated.createdAt
    });
  } catch (e) {
    next(e);
  }
});

export default router;

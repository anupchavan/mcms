import express from 'express';
const router = express.Router();
import ActionItem = require('../models/ActionItem');

export = function ({ protect, usingMongo, Notification, emitToUser, inMemoryActionItems, io, ActionItem: DbActionItem, User }: any) {
    const processItem = (i: any) => {
        const item = i.toObject ? i.toObject() : i;
        let status = item.status;
        if (status !== 'completed' && item.deadline) {
            const now = new Date();
            const deadline = new Date(item.deadline);
            if (deadline < now) {
                status = 'missing';
            }
        }
        return {
            id: (item._id || item.id).toString(),
            title: item.title,
            assignee: item.assigneeName || item.assignee?.name || 'Unassigned',
            assigneeId: (item.assignee?._id || item.assignee)?.toString(),
            category: item.category,
            status: status,
            deadline: item.deadline,
            agendaItemId: item.agendaItemId,
            source: item.source,
            aiConfidence: item.aiConfidence,
            meetingId: (item.meetingId?._id || item.meetingId)?.toString(),
            meetingTitle: item.meetingId?.title || null,
        };
    };

    const broadcastSync = async (meetingId: string) => {
        if (!io) return;
        const mId = meetingId.toString();
        let items = [];
        if (usingMongo() && ActionItem) {
            const dbItems = await ActionItem.find({ meetingId: mId }).populate('assignee', 'name email').sort({ createdAt: 1 });
            items = dbItems.map(processItem);
        } else {
            items = inMemoryActionItems[meetingId] || [];
        }
        io.to(`meeting:${mId}`).emit('action_items_sync', { meetingId: mId, items });
    };

    router.get('/mine', protect, async (req: any, res: any) => {
        try {
            if (usingMongo() && ActionItem) {
                const items = await ActionItem.find({ assignee: req.user.id })
                    .populate('meetingId', 'title')
                    .populate('assignee', 'name email')
                    .sort({ deadline: 1 });
                return res.json(items.map(processItem));
            }
            res.json([]);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.get('/:meetingId', protect, async (req: any, res: any) => {
        try {
            if (usingMongo() && ActionItem) {
                const items = await ActionItem.find({ meetingId: req.params.meetingId })
                    .populate('meetingId', 'title')
                    .populate('assignee', 'name email')
                    .sort({ createdAt: 1 });
                return res.json(items.map(processItem));
            }
            res.json(inMemoryActionItems[req.params.meetingId] || []);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.post('/:meetingId', protect, async (req: any, res: any) => {
        try {
            const { title, assignee, assigneeName, category, status, deadline, agendaItemId, source, aiConfidence } = req.body;

            if (!usingMongo()) {
                const item = {
                    id: `ai-${Date.now()}`, title, assignee: assigneeName || 'Unassigned',
                    category: category || 'Technical', status: status || 'pending',
                    deadline, agendaItemId: agendaItemId || null,
                };
                if (!inMemoryActionItems[req.params.meetingId]) inMemoryActionItems[req.params.meetingId] = [];
                inMemoryActionItems[req.params.meetingId].push(item);
                broadcastSync(req.params.meetingId);
                return res.status(201).json(item);
            }

            let finalAssigneeId = assignee || null;
            let finalAssigneeName = assigneeName || null;

            // If assignee is provided but is just a string name, push it to assigneeName
            if (finalAssigneeId && !/^[0-9a-fA-F]{24}$/.test(finalAssigneeId)) {
                finalAssigneeName = finalAssigneeId;
                finalAssigneeId = null;
            }

            // Attempt name-based resolution
            if (usingMongo() && User && !finalAssigneeId && finalAssigneeName) {
                const safeAssignee = finalAssigneeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const globalUser = await User.findOne({ 
                    $or: [
                        { name: { $regex: new RegExp(`^${safeAssignee}$`, 'i') } },
                        { email: { $regex: new RegExp(`^${safeAssignee}$`, 'i') } }
                    ]
                });
                if (globalUser) {
                    finalAssigneeId = globalUser._id;
                    // Keep the formal name if possible
                    finalAssigneeName = globalUser.name;
                }
            }

            const item = await ActionItem.create({
                meetingId: req.params.meetingId,
                title, assignee: finalAssigneeId,
                assigneeName: finalAssigneeName,
                category: category || 'Technical',
                status: status || 'pending',
                deadline: deadline || null,
                agendaItemId: agendaItemId || null,
                source: source || 'manual',
                aiConfidence: aiConfidence || null,
            });

            if (finalAssigneeId && Notification) {
                try {
                    const notif = await Notification.create({
                        userId: finalAssigneeId, type: 'action_item_assigned',
                        meetingId: req.params.meetingId,
                        message: `You've been assigned: "${title}"`,
                    });
                    emitToUser(finalAssigneeId, 'notification', {
                        _id: notif._id, type: notif.type,
                        meetingId: req.params.meetingId, message: notif.message,
                        read: false, createdAt: notif.createdAt,
                    });
                } catch (e) { /* non-critical */ }
            }

            const populated = await ActionItem.findById(item._id).populate('meetingId', 'title').populate('assignee', 'name email');
            res.status(201).json(processItem(populated));
            broadcastSync(req.params.meetingId);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.put('/:id', protect, async (req: any, res: any) => {
        try {
            const updates: any = {};
            const allowed = ['title', 'assignee', 'assigneeName', 'category', 'status', 'deadline'];
            for (const key of allowed) {
                if (req.body[key] !== undefined) updates[key] = req.body[key];
            }

            if (!usingMongo()) {
                // In-memory fallback
                let found = null;
                for (const mId in inMemoryActionItems) {
                    const idx = inMemoryActionItems[mId].findIndex((i: any) => (i.id || i._id) === req.params.id);
                    if (idx !== -1) {
                        found = { mId, idx };
                        break;
                    }
                }
                if (!found) return res.status(404).json({ message: 'Item not found' });
                const item = inMemoryActionItems[found.mId][found.idx];
                Object.assign(item, updates);
                if (updates.assigneeName) item.assignee = updates.assigneeName;
                broadcastSync(found.mId);
                return res.json(item);
            }

            // If assignee is provided but is just a string name, push it to assigneeName
            if (updates.assignee && !/^[0-9a-fA-F]{24}$/.test(updates.assignee)) {
                updates.assigneeName = updates.assignee;
                delete updates.assignee;
            }

            // Name resolution if assigneeName provided but no assignee ObjectId
            if (usingMongo() && User && updates.assigneeName && !updates.assignee) {
                const safeAssignee = updates.assigneeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const globalUser = await User.findOne({
                    $or: [
                        { name: { $regex: new RegExp(`^${safeAssignee}$`, 'i') } },
                        { email: { $regex: new RegExp(`^${safeAssignee}$`, 'i') } }
                    ]
                });
                if (globalUser) {
                    updates.assignee = globalUser._id;
                    updates.assigneeName = globalUser.name;
                }
            }

            const item = await ActionItem.findByIdAndUpdate(req.params.id, updates, { new: true })
                .populate('meetingId', 'title')
                .populate('assignee', 'name email');
            if (!item) return res.status(404).json({ message: 'Action item not found' });

            res.json(processItem(item));
            broadcastSync((item as any).meetingId._id.toString());
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.delete('/:id', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo()) {
                let found = null;
                for (const mId in inMemoryActionItems) {
                    const idx = inMemoryActionItems[mId].findIndex((i: any) => (i.id || i._id) === req.params.id);
                    if (idx !== -1) {
                        found = { mId, idx };
                        break;
                    }
                }
                if (!found) return res.status(404).json({ message: 'Not found' });
                inMemoryActionItems[found.mId].splice(found.idx, 1);
                broadcastSync(found.mId);
                return res.json({ message: 'Deleted' });
            }
            
            const item = await ActionItem.findById(req.params.id);
            if (!item) return res.status(404).json({ message: 'Not found' });
            const meetingId = item.meetingId;
            await ActionItem.findByIdAndDelete(req.params.id);
            broadcastSync(meetingId.toString());
            res.json({ message: 'Deleted' });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};

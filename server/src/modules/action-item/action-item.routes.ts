import express from 'express';
const router = express.Router();
import ActionItem = require('./action-item.schema');

export = function ({ protect, usingMongo, Notification, emitToUser, inMemoryActionItems, io, ActionItem: DbActionItem }: any) {
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
                const items = await ActionItem.find({ assignee: req.user._id })
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

            const item = await ActionItem.create({
                meetingId: req.params.meetingId,
                title, assignee: assignee || null,
                assigneeName: assigneeName || null,
                category: category || 'Technical',
                status: status || 'pending',
                deadline: deadline || null,
                agendaItemId: agendaItemId || null,
                source: source || 'manual',
                aiConfidence: aiConfidence || null,
            });

            if (assignee && Notification) {
                try {
                    const notif = await Notification.create({
                        userId: assignee, type: 'action_item_assigned',
                        meetingId: req.params.meetingId,
                        message: `You've been assigned: "${title}"`,
                    });
                    emitToUser(assignee, 'notification', {
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
            if (!usingMongo()) return res.status(400).json({ message: 'Database required' });

            const updates: any = {};
            const allowed = ['title', 'assignee', 'assigneeName', 'category', 'status', 'deadline'];
            for (const key of allowed) {
                if (req.body[key] !== undefined) updates[key] = req.body[key];
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
            if (!usingMongo()) return res.status(400).json({ message: 'Database required' });
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

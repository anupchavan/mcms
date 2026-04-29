import express from 'express';
const router = express.Router();
import ActionItem = require('./action-item.schema');

export = function ({ protect, usingMongo, Notification, emitToUser, inMemoryActionItems, io, Meeting, inMemoryMeetings, Agenda, inMemoryAgendas }: any) {
    const HOST_ALLOWED_STATUSES = ['draft', 'pending', 'in-progress', 'completed', 'verified', 'missing'];
    const ASSIGNEE_ALLOWED_STATUSES = ['pending', 'in-progress', 'completed'];
    const getUserId = (req: any) => String(req.user?.id || req.user?._id || '');
    const getHostId = (meeting: any) => String(meeting?.hostId?._id || meeting?.hostId || '');
    const getAssigneeId = (item: any) => String(item?.assignee?._id || item?.assignee || '');
    const normalizeFeedback = (value: any) => typeof value === 'string' ? value.trim() : '';
    const getAgendaItemsForMeeting = async (meetingId: string) => {
        if (usingMongo() && Agenda) {
            const agendaDoc = await Agenda.findOne({ meetingId }).select('items activeItemId');
            return {
                items: (agendaDoc as any)?.items || [],
                activeItemId: (agendaDoc as any)?.activeItemId || null,
            };
        }

        const items = inMemoryAgendas?.[meetingId] || [];
        const activeItem = items.find((agendaItem: any) => ['active', 'in-progress'].includes(String(agendaItem?.status || '').toLowerCase()));
        return {
            items,
            activeItemId: activeItem?.id || null,
        };
    };

    const resolveAgendaItemId = async (meetingId: string, requestedAgendaItemId: any, opts: { defaultToActive?: boolean } = {}) => {
        const normalizedRequested = typeof requestedAgendaItemId === 'string' ? requestedAgendaItemId.trim() : '';
        const defaultToActive = opts.defaultToActive !== false;
        const { items, activeItemId } = await getAgendaItemsForMeeting(meetingId);
        const validAgendaIds = new Set((items || []).map((agendaItem: any) => String(agendaItem.id)));

        if (normalizedRequested) {
            if (!validAgendaIds.has(normalizedRequested)) {
                throw new Error('Invalid agenda item selected');
            }
            return normalizedRequested;
        }

        if (!defaultToActive) return null;
        if (activeItemId && validAgendaIds.has(String(activeItemId))) return String(activeItemId);
        return null;
    };

    const createNotification = async (userId: string, type: string, meetingId: string, message: string) => {
        if (!Notification || !userId) return;
        try {
            const notif = await Notification.create({ userId, type, meetingId, message });
            emitToUser(userId, 'notification', {
                _id: notif._id,
                type: notif.type,
                meetingId,
                message: notif.message,
                read: false,
                createdAt: notif.createdAt,
            });
        } catch (e) { /* non-critical */ }
    };

    const processItem = (i: any) => {
        const item = i.toObject ? i.toObject() : i;
        let status = item.status;
        if (!['completed', 'verified'].includes(status) && item.deadline) {
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
            meetingHostId: (item.meetingId?.hostId?._id || item.meetingId?.hostId)?.toString() || null,
            assignedAt: item.createdAt || null,
            completionSubmittedAt: item.completionSubmittedAt || null,
            verifiedAt: item.verifiedAt || null,
            hostFeedback: item.hostFeedback || null,
        };
    };

    const broadcastSync = async (meetingId: string) => {
        if (!io) return;
        const mId = meetingId.toString();
        let items = [];
        if (usingMongo() && ActionItem) {
            const dbItems = await ActionItem.find({ meetingId: mId })
                .populate('meetingId', 'title hostId')
                .populate('assignee', 'name email')
                .sort({ createdAt: 1 });
            items = dbItems.map(processItem);
        } else {
            items = inMemoryActionItems[meetingId] || [];
        }
        io.to(`meeting:${mId}`).emit('action_items_sync', { meetingId: mId, items });
    };

    router.get('/mine', protect, async (req: any, res: any) => {
        try {
            if (usingMongo() && ActionItem) {
                const items = await ActionItem.find({ assignee: getUserId(req) })
                    .populate('meetingId', 'title hostId')
                    .populate('assignee', 'name email')
                    .sort({ deadline: 1 });
                return res.json(items.map(processItem));
            }
            res.json([]);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.get('/mine/overview', protect, async (req: any, res: any) => {
        try {
            const userId = getUserId(req);

            if (usingMongo() && ActionItem && Meeting) {
                const hostedMeetings = await Meeting.find({ hostId: userId }).select('_id');
                const hostedMeetingIds = hostedMeetings.map((meeting: any) => meeting._id);

                const [assignedToMe, assignedByMe] = await Promise.all([
                    ActionItem.find({ assignee: userId })
                        .populate('meetingId', 'title hostId')
                        .populate('assignee', 'name email')
                        .sort({ createdAt: -1 }),
                    hostedMeetingIds.length > 0
                        ? ActionItem.find({
                            meetingId: { $in: hostedMeetingIds },
                            assignee: { $nin: [null, userId] },
                        })
                            .populate('meetingId', 'title hostId')
                            .populate('assignee', 'name email')
                            .sort({ createdAt: -1 })
                        : Promise.resolve([]),
                ]);

                return res.json({
                    assignedToMe: assignedToMe.map(processItem),
                    assignedByMe: assignedByMe.map(processItem),
                });
            }

            const hostedMeetingIds = new Set(
                (inMemoryMeetings || [])
                    .filter((meeting: any) => String(meeting.hostId || '') === userId)
                    .map((meeting: any) => String(meeting.id || meeting._id)),
            );
            const allItems = Object.entries(inMemoryActionItems || {}).flatMap(([meetingId, items]: [string, any]) =>
                (items || []).map((item: any) => ({ ...item, meetingId })),
            );

            return res.json({
                assignedToMe: allItems.filter((item: any) => String(item.assigneeId || '') === userId),
                assignedByMe: allItems.filter((item: any) => hostedMeetingIds.has(String(item.meetingId || '')) && String(item.assigneeId || '') !== userId),
            });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.get('/:meetingId', protect, async (req: any, res: any) => {
        try {
            if (usingMongo() && ActionItem) {
                const items = await ActionItem.find({ meetingId: req.params.meetingId })
                    .populate('meetingId', 'title hostId')
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
                let resolvedAgendaItemId = null;
                try {
                    resolvedAgendaItemId = await resolveAgendaItemId(req.params.meetingId, agendaItemId);
                } catch (error: any) {
                    return res.status(400).json({ message: error.message || 'Invalid agenda item selected' });
                }
                const item = {
                    id: `ai-${Date.now()}`, title, assignee: assigneeName || 'Unassigned',
                    category: category || 'Technical', status: status || 'pending',
                    deadline, agendaItemId: resolvedAgendaItemId,
                };
                if (!inMemoryActionItems[req.params.meetingId]) inMemoryActionItems[req.params.meetingId] = [];
                inMemoryActionItems[req.params.meetingId].push(item);
                broadcastSync(req.params.meetingId);
                return res.status(201).json(item);
            }

            const meeting = await Meeting.findById(req.params.meetingId).select('hostId');
            if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
            if (getHostId(meeting) !== getUserId(req)) {
                return res.status(403).json({ message: 'Only the meeting host can create action items' });
            }

            let resolvedAgendaItemId = null;
            try {
                resolvedAgendaItemId = await resolveAgendaItemId(req.params.meetingId, agendaItemId);
            } catch (error: any) {
                return res.status(400).json({ message: error.message || 'Invalid agenda item selected' });
            }

            const item = await ActionItem.create({
                meetingId: req.params.meetingId,
                title, assignee: assignee || null,
                assigneeName: assigneeName || null,
                category: category || 'Technical',
                status: status || 'pending',
                deadline: deadline || null,
                agendaItemId: resolvedAgendaItemId,
                source: source || 'manual',
                aiConfidence: aiConfidence || null,
            });

            if (assignee) await createNotification(
                assignee,
                'action_item_assigned',
                req.params.meetingId,
                `You've been assigned: "${title}"`,
            );

            const populated = await ActionItem.findById(item._id).populate('meetingId', 'title hostId').populate('assignee', 'name email');
            res.status(201).json(processItem(populated));
            broadcastSync(req.params.meetingId);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.put('/:id', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo()) return res.status(400).json({ message: 'Database required' });

            const item = await ActionItem.findById(req.params.id)
                .populate('meetingId', 'title hostId')
                .populate('assignee', 'name email');
            if (!item) return res.status(404).json({ message: 'Action item not found' });

            const userId = getUserId(req);
            const isHost = getHostId((item as any).meetingId) === userId;
            const isAssignee = getAssigneeId(item) === userId;
            const requestedKeys = Object.keys(req.body).filter((key) => req.body[key] !== undefined);
            const statusOnlyKeys = ['status'];
            const hostEditableKeys = ['title', 'assignee', 'assigneeName', 'category', 'deadline', 'status', 'hostFeedback', 'agendaItemId'];
            const allowedKeys = isHost ? hostEditableKeys : (isAssignee ? statusOnlyKeys : []);

            if (allowedKeys.length === 0) {
                return res.status(403).json({ message: 'You do not have permission to edit this action item' });
            }
            if (requestedKeys.length === 0) {
                return res.status(400).json({ message: 'No valid updates provided' });
            }

            const hasDisallowedField = requestedKeys.some((key) => !allowedKeys.includes(key));
            if (hasDisallowedField) {
                return res.status(403).json({
                    message: isHost
                        ? 'Only supported action item fields can be updated'
                        : 'Only the assignee or host can update the status',
                });
            }

            const updates: any = {};
            for (const key of allowedKeys) {
                if (req.body[key] !== undefined) updates[key] = req.body[key];
            }

            const currentStatus = String((item as any).status || '');
            const nextStatus = req.body.status !== undefined ? String(req.body.status) : currentStatus;
            const meetingId = (item as any).meetingId._id.toString();
            const assigneeId = getAssigneeId(item);
            const assigneeName = (item as any).assigneeName || (item as any).assignee?.name || 'The assignee';
            const hostFeedback = normalizeFeedback(req.body.hostFeedback);

            if (isHost && req.body.agendaItemId !== undefined) {
                try {
                    updates.agendaItemId = await resolveAgendaItemId(meetingId, req.body.agendaItemId, { defaultToActive: false });
                } catch (error: any) {
                    return res.status(400).json({ message: error.message || 'Invalid agenda item selected' });
                }
            }

            if (!isHost && currentStatus === 'verified') {
                return res.status(403).json({ message: 'Verified action items can only be changed by the host' });
            }

            if (req.body.status !== undefined) {
                const allowedStatuses = isHost ? HOST_ALLOWED_STATUSES : ASSIGNEE_ALLOWED_STATUSES;
                if (!allowedStatuses.includes(nextStatus)) {
                    return res.status(400).json({ message: 'Invalid action item status' });
                }
                if (nextStatus !== 'verified') {
                    updates.verifiedAt = null;
                }
            }

            if (isHost && req.body.status !== undefined) {
                if (nextStatus === 'verified' && currentStatus !== 'completed') {
                    return res.status(400).json({ message: 'Only completed action items can be marked as verified' });
                }

                if (currentStatus === 'completed' && nextStatus === 'pending') {
                    if (!hostFeedback) {
                        return res.status(400).json({ message: 'A feedback message is required when sending an item back to pending' });
                    }
                    updates.hostFeedback = hostFeedback;
                    updates.verifiedAt = null;
                } else if (nextStatus === 'verified') {
                    updates.verifiedAt = new Date();
                    // Preserve optional verification note from host (if provided)
                    updates.hostFeedback = hostFeedback || null;
                } else if (req.body.hostFeedback !== undefined) {
                    updates.hostFeedback = hostFeedback || null;
                }
            }

            if (!isHost && req.body.status !== undefined && nextStatus === 'completed') {
                updates.completionSubmittedAt = new Date();
                updates.verifiedAt = null;
                updates.hostFeedback = null;
            }

            await ActionItem.findByIdAndUpdate(req.params.id, updates, { new: true });
            const updatedItem = await ActionItem.findById(req.params.id)
                .populate('meetingId', 'title hostId')
                .populate('assignee', 'name email');

            if (!updatedItem) return res.status(404).json({ message: 'Action item not found' });

            if (!isHost && req.body.status !== undefined && nextStatus === 'completed') {
                const hostId = getHostId((updatedItem as any).meetingId);
                if (hostId && hostId !== userId) {
                    await createNotification(
                        hostId,
                        'action_item_completion_submitted',
                        meetingId,
                        `${assigneeName} marked "${(updatedItem as any).title}" as completed. Please verify it.`,
                    );
                }
            }

            if (isHost && req.body.status !== undefined) {
                if (nextStatus === 'verified' && assigneeId) {
                    const verifyNote = updates.hostFeedback ? ` Note: ${updates.hostFeedback}` : '';
                    await createNotification(
                        assigneeId,
                        'action_item_verified',
                        meetingId,
                        `Your action item "${(updatedItem as any).title}" was verified by the host.${verifyNote}`,
                    );
                } else if (currentStatus === 'completed' && nextStatus === 'pending' && assigneeId) {
                    await createNotification(
                        assigneeId,
                        'action_item_rejected',
                        meetingId,
                        `Host feedback on "${(updatedItem as any).title}": ${updates.hostFeedback}`,
                    );
                }
            }

            // Standalone feedback: host sent hostFeedback without a status-triggered notification
            const feedbackNotificationAlreadySent =
                (nextStatus === 'verified') ||
                (currentStatus === 'completed' && nextStatus === 'pending');
            if (
                isHost &&
                updates.hostFeedback &&
                req.body.hostFeedback !== undefined &&
                req.body.status === undefined &&   // pure feedback-only update
                assigneeId &&
                !feedbackNotificationAlreadySent
            ) {
                await createNotification(
                    assigneeId,
                    'action_item_feedback',
                    meetingId,
                    `Host note on "${(updatedItem as any).title}": ${updates.hostFeedback}`,
                );
            }

            res.json(processItem(updatedItem));
            broadcastSync((updatedItem as any).meetingId._id.toString());
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.delete('/:id', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo()) return res.status(400).json({ message: 'Database required' });
            const item = await ActionItem.findById(req.params.id);
            if (!item) return res.status(404).json({ message: 'Not found' });

            const meeting = await Meeting.findById(item.meetingId).select('hostId');
            if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
            if (getHostId(meeting) !== getUserId(req)) {
                return res.status(403).json({ message: 'Only the meeting host can delete action items' });
            }

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

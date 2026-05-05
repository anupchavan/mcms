import express from 'express';
const router = express.Router();
import Task = require('./task.schema');

export = function ({ protect, usingMongo, Notification, emitToUser, inMemoryActionItems, io, Meeting, inMemoryMeetings, Agenda, inMemoryAgendas }: any) {
    /** Legacy alias kept for in-memory mode where existing code paths still use the `inMemoryActionItems` map. */
    const inMemoryTasks = inMemoryActionItems;

    const HOST_ALLOWED_STATUSES = ['draft', 'pending', 'in-progress', 'completed', 'verified', 'missing'];
    const ASSIGNEE_ALLOWED_STATUSES = ['pending', 'in-progress', 'completed'];
    const getUserId = (req: any) => String(req.user?.id || req.user?._id || '');
    const getHostId = (meeting: any) => String(meeting?.hostId?._id || meeting?.hostId || '');
    const getAssigneeIds = (item: any): string[] => {
        const list = Array.isArray(item?.assignees) ? item.assignees : [];
        const ids = list
            .map((a: any) => String(a?._id || a))
            .filter(Boolean);
        if (ids.length > 0) return ids;
        const legacy = String(item?.assignee?._id || item?.assignee || '');
        return legacy ? [legacy] : [];
    };
    const normalizeFeedback = (value: any) => typeof value === 'string' ? value.trim() : '';

    const normalizeAssigneesInput = (body: any): {
        ids: string[] | null;
        legacyAssignee: string | null;
        legacyAssigneeName: string | null;
    } => {
        if (Array.isArray(body.assignees)) {
            const ids = body.assignees
                .map((v: any) => (v == null ? '' : String(v)))
                .filter((v: string) => Boolean(v));
            return { ids, legacyAssignee: ids[0] || null, legacyAssigneeName: body.assigneeName || null };
        }
        if (body.assignee !== undefined || body.assigneeName !== undefined) {
            const single = body.assignee ? String(body.assignee) : null;
            return {
                ids: single ? [single] : [],
                legacyAssignee: single,
                legacyAssigneeName: body.assigneeName || null,
            };
        }
        return { ids: null, legacyAssignee: null, legacyAssigneeName: null };
    };

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

        // Build assignees from canonical array, falling back to legacy single fields.
        const rawAssignees = Array.isArray(item.assignees) ? item.assignees : [];
        let assignees = rawAssignees
            .map((a: any) => ({
                id: String(a?._id || a || ''),
                name: a?.name || null,
                email: a?.email || null,
                profileImage: a?.profileImage || null,
            }))
            .filter((a: any) => a.id);
        if (assignees.length === 0 && (item.assignee || item.assigneeName)) {
            assignees = [{
                id: (item.assignee?._id || item.assignee)?.toString() || '',
                name: item.assigneeName || item.assignee?.name || null,
                email: item.assignee?.email || null,
                profileImage: item.assignee?.profileImage || null,
            }];
        }

        const legacyDisplay = assignees.length > 0
            ? (assignees[0].name || 'Unassigned')
            : (item.assigneeName || item.assignee?.name || 'Unassigned');

        return {
            id: (item._id || item.id).toString(),
            title: item.title,
            assignees,
            assignee: legacyDisplay,
            assigneeId: assignees[0]?.id || (item.assignee?._id || item.assignee)?.toString(),
            category: item.category,
            status: status,
            deadline: item.deadline,
            agendaItemId: item.agendaItemId,
            source: item.source,
            aiConfidence: item.aiConfidence,
            meetingId: (item.meetingId?._id || item.meetingId)?.toString(),
            meetingTitle: item.meetingId?.title || null,
            meetingHostName: item.meetingId?.host || null,
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
        if (usingMongo() && Task) {
            const dbItems = await Task.find({ meetingId: mId })
                .populate('meetingId', 'title hostId')
                .populate('assignee', 'name email profileImage')
                .populate('assignees', 'name email profileImage')
                .sort({ createdAt: 1 });
            items = dbItems.map(processItem);
        } else {
            items = inMemoryTasks[meetingId] || [];
        }
        io.to(`meeting:${mId}`).emit('tasks_sync', { meetingId: mId, items });
    };

    router.get('/mine', protect, async (req: any, res: any) => {
        try {
            if (usingMongo() && Task) {
                const userId = getUserId(req);
                const items = await Task.find({
                    $or: [{ assignees: userId }, { assignee: userId }],
                })
                    .populate('meetingId', 'title hostId')
                    .populate('assignee', 'name email profileImage')
                    .populate('assignees', 'name email profileImage')
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

            if (usingMongo() && Task && Meeting) {
                const hostedMeetings = await Meeting.find({ hostId: userId }).select('_id');
                const hostedMeetingIds = hostedMeetings.map((meeting: any) => meeting._id);

                const [assignedToMe, assignedByMe] = await Promise.all([
                    Task.find({ $or: [{ assignees: userId }, { assignee: userId }] })
                        .populate('meetingId', 'title host hostId')
                        .populate('assignee', 'name email profileImage')
                        .populate('assignees', 'name email profileImage')
                        .sort({ createdAt: -1 }),
                    hostedMeetingIds.length > 0
                        ? Task.find({
                            meetingId: { $in: hostedMeetingIds },
                            $nor: [
                                { assignees: userId },
                                { assignee: userId },
                            ],
                        })
                            .populate('meetingId', 'title host hostId')
                            .populate('assignee', 'name email profileImage')
                            .populate('assignees', 'name email profileImage')
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
            const allItems = Object.entries(inMemoryTasks || {}).flatMap(([meetingId, items]: [string, any]) =>
                (items || []).map((item: any) => ({ ...item, meetingId })),
            );

            return res.json({
                assignedToMe: allItems
                    .filter((item: any) => String(item.assigneeId || '') === userId)
                    .map((item: any) => {
                        const meeting = (inMemoryMeetings || []).find((m: any) => String(m.id || m._id) === String(item.meetingId || ''));
                        return {
                            ...item,
                            meetingTitle: item.meetingTitle || meeting?.title || null,
                            meetingHostName: item.meetingHostName || meeting?.host || null,
                        };
                    }),
                assignedByMe: allItems
                    .filter((item: any) => hostedMeetingIds.has(String(item.meetingId || '')) && String(item.assigneeId || '') !== userId)
                    .map((item: any) => {
                        const meeting = (inMemoryMeetings || []).find((m: any) => String(m.id || m._id) === String(item.meetingId || ''));
                        return {
                            ...item,
                            meetingTitle: item.meetingTitle || meeting?.title || null,
                            meetingHostName: item.meetingHostName || meeting?.host || null,
                        };
                    }),
            });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.get('/:meetingId', protect, async (req: any, res: any) => {
        try {
            if (usingMongo() && Task) {
                const items = await Task.find({ meetingId: req.params.meetingId })
                    .populate('meetingId', 'title host hostId')
                    .populate('assignee', 'name email profileImage')
                    .populate('assignees', 'name email profileImage')
                    .sort({ createdAt: 1 });
                return res.json(items.map(processItem));
            }
            res.json(inMemoryTasks[req.params.meetingId] || []);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.post('/:meetingId', protect, async (req: any, res: any) => {
        try {
            const { title, category, status, deadline, agendaItemId, source, aiConfidence } = req.body;
            const { ids: assigneeIds, legacyAssignee, legacyAssigneeName } = normalizeAssigneesInput(req.body);

            if (!usingMongo()) {
                let resolvedAgendaItemId = null;
                try {
                    resolvedAgendaItemId = await resolveAgendaItemId(req.params.meetingId, agendaItemId);
                } catch (error: any) {
                    return res.status(400).json({ message: error.message || 'Invalid agenda item selected' });
                }
                const item = {
                    id: `ai-${Date.now()}`, title,
                    assignee: legacyAssigneeName || 'Unassigned',
                    category: category || 'Technical', status: status || 'pending',
                    deadline, agendaItemId: resolvedAgendaItemId,
                };
                if (!inMemoryTasks[req.params.meetingId]) inMemoryTasks[req.params.meetingId] = [];
                inMemoryTasks[req.params.meetingId].push(item);
                broadcastSync(req.params.meetingId);
                return res.status(201).json(item);
            }

            const meeting = await Meeting.findById(req.params.meetingId).select('hostId');
            if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
            if (getHostId(meeting) !== getUserId(req)) {
                return res.status(403).json({ message: 'Only the meeting host can create tasks' });
            }

            let resolvedAgendaItemId = null;
            try {
                resolvedAgendaItemId = await resolveAgendaItemId(req.params.meetingId, agendaItemId);
            } catch (error: any) {
                return res.status(400).json({ message: error.message || 'Invalid agenda item selected' });
            }

            const finalAssignees = assigneeIds ?? [];
            const item = await Task.create({
                meetingId: req.params.meetingId,
                title,
                assignees: finalAssignees,
                assignee: legacyAssignee || null,
                assigneeName: legacyAssigneeName || null,
                category: category || 'Technical',
                status: status || 'pending',
                deadline: deadline || null,
                agendaItemId: resolvedAgendaItemId,
                source: source || 'manual',
                aiConfidence: aiConfidence || null,
            });

            for (const aid of finalAssignees) {
                await createNotification(
                    aid,
                    'task_assigned',
                    req.params.meetingId,
                    `You've been assigned: "${title}"`,
                );
            }

            const populated = await Task.findById(item._id)
                .populate('meetingId', 'title host hostId')
                .populate('assignee', 'name email profileImage')
                .populate('assignees', 'name email profileImage');
            res.status(201).json(processItem(populated));
            broadcastSync(req.params.meetingId);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.put('/:id', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo()) return res.status(400).json({ message: 'Database required' });

            const item = await Task.findById(req.params.id)
                .populate('meetingId', 'title host hostId')
                .populate('assignee', 'name email profileImage')
                .populate('assignees', 'name email profileImage');
            if (!item) return res.status(404).json({ message: 'Task not found' });

            const userId = getUserId(req);
            const isHost = getHostId((item as any).meetingId) === userId;
            const isAssignee = getAssigneeIds(item).includes(userId);
            const requestedKeys = Object.keys(req.body).filter((key) => req.body[key] !== undefined);
            const statusOnlyKeys = ['status'];
            const hostEditableKeys = ['title', 'assignee', 'assigneeName', 'assignees', 'category', 'deadline', 'status', 'hostFeedback', 'agendaItemId'];
            const allowedKeys = isHost ? hostEditableKeys : (isAssignee ? statusOnlyKeys : []);

            if (allowedKeys.length === 0) {
                return res.status(403).json({ message: 'You do not have permission to edit this task' });
            }
            if (requestedKeys.length === 0) {
                return res.status(400).json({ message: 'No valid updates provided' });
            }

            const hasDisallowedField = requestedKeys.some((key) => !allowedKeys.includes(key));
            if (hasDisallowedField) {
                return res.status(403).json({
                    message: isHost
                        ? 'Only supported task fields can be updated'
                        : 'Only the assignee or host can update the status',
                });
            }

            const updates: any = {};
            for (const key of allowedKeys) {
                if (req.body[key] !== undefined) updates[key] = req.body[key];
            }

            // Normalize assignees: if either `assignee` or `assignees` was passed, sync both representations.
            if (
                isHost
                && (req.body.assignees !== undefined || req.body.assignee !== undefined || req.body.assigneeName !== undefined)
            ) {
                const { ids, legacyAssignee, legacyAssigneeName } = normalizeAssigneesInput(req.body);
                if (ids != null) updates.assignees = ids;
                if (req.body.assignee !== undefined || ids != null) updates.assignee = legacyAssignee || null;
                if (req.body.assigneeName !== undefined) updates.assigneeName = legacyAssigneeName;
                else if (ids != null && ids.length === 0) updates.assigneeName = null;
            }

            const currentStatus = String((item as any).status || '');
            const nextStatus = req.body.status !== undefined ? String(req.body.status) : currentStatus;
            const meetingId = (item as any).meetingId._id.toString();
            const previousAssigneeIds = getAssigneeIds(item);
            const assigneeName = (item as any).assigneeName || (item as any).assignee?.name || (item as any).assignees?.[0]?.name || 'The assignee';
            const hostFeedback = normalizeFeedback(req.body.hostFeedback);

            if (isHost && req.body.agendaItemId !== undefined) {
                try {
                    updates.agendaItemId = await resolveAgendaItemId(meetingId, req.body.agendaItemId, { defaultToActive: false });
                } catch (error: any) {
                    return res.status(400).json({ message: error.message || 'Invalid agenda item selected' });
                }
            }

            if (!isHost && currentStatus === 'verified') {
                return res.status(403).json({ message: 'Verified tasks can only be changed by the host' });
            }

            if (req.body.status !== undefined) {
                const allowedStatuses = isHost ? HOST_ALLOWED_STATUSES : ASSIGNEE_ALLOWED_STATUSES;
                if (!allowedStatuses.includes(nextStatus)) {
                    return res.status(400).json({ message: 'Invalid task status' });
                }
                if (nextStatus !== 'verified') {
                    updates.verifiedAt = null;
                }
            }

            if (isHost && req.body.status !== undefined) {
                if (nextStatus === 'verified' && currentStatus !== 'completed') {
                    return res.status(400).json({ message: 'Only completed tasks can be marked as verified' });
                }

                if (currentStatus === 'completed' && nextStatus === 'pending') {
                    if (!hostFeedback) {
                        return res.status(400).json({ message: 'A feedback message is required when sending a task back to pending' });
                    }
                    updates.hostFeedback = hostFeedback;
                    updates.verifiedAt = null;
                } else if (nextStatus === 'verified') {
                    updates.verifiedAt = new Date();
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

            await Task.findByIdAndUpdate(req.params.id, updates, { new: true });
            const updatedItem = await Task.findById(req.params.id)
                .populate('meetingId', 'title host hostId')
                .populate('assignee', 'name email profileImage')
                .populate('assignees', 'name email profileImage');

            if (!updatedItem) return res.status(404).json({ message: 'Task not found' });

            const newAssigneeIds = getAssigneeIds(updatedItem);
            const addedAssignees = newAssigneeIds.filter((id) => !previousAssigneeIds.includes(id));

            if (isHost && addedAssignees.length > 0) {
                for (const aid of addedAssignees) {
                    if (aid === userId) continue;
                    await createNotification(
                        aid,
                        'task_assigned',
                        meetingId,
                        `You've been assigned: "${(updatedItem as any).title}"`,
                    );
                }
            }

            if (!isHost && req.body.status !== undefined && nextStatus === 'completed') {
                const hostId = getHostId((updatedItem as any).meetingId);
                if (hostId && hostId !== userId) {
                    await createNotification(
                        hostId,
                        'task_completion_submitted',
                        meetingId,
                        `${assigneeName} marked "${(updatedItem as any).title}" as completed. Please verify it.`,
                    );
                }
            }

            if (isHost && req.body.status !== undefined) {
                if (nextStatus === 'verified' && newAssigneeIds.length > 0) {
                    const verifyNote = updates.hostFeedback ? ` Note: ${updates.hostFeedback}` : '';
                    for (const aid of newAssigneeIds) {
                        await createNotification(
                            aid,
                            'task_verified',
                            meetingId,
                            `Your task "${(updatedItem as any).title}" was verified by the host.${verifyNote}`,
                        );
                    }
                } else if (currentStatus === 'completed' && nextStatus === 'pending' && newAssigneeIds.length > 0) {
                    for (const aid of newAssigneeIds) {
                        await createNotification(
                            aid,
                            'task_rejected',
                            meetingId,
                            `Host feedback on "${(updatedItem as any).title}": ${updates.hostFeedback}`,
                        );
                    }
                }
            }

            const feedbackNotificationAlreadySent =
                (nextStatus === 'verified') ||
                (currentStatus === 'completed' && nextStatus === 'pending');
            if (
                isHost &&
                updates.hostFeedback &&
                req.body.hostFeedback !== undefined &&
                req.body.status === undefined &&
                newAssigneeIds.length > 0 &&
                !feedbackNotificationAlreadySent
            ) {
                for (const aid of newAssigneeIds) {
                    await createNotification(
                        aid,
                        'task_feedback',
                        meetingId,
                        `Host note on "${(updatedItem as any).title}": ${updates.hostFeedback}`,
                    );
                }
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
            const item = await Task.findById(req.params.id);
            if (!item) return res.status(404).json({ message: 'Not found' });

            const meeting = await Meeting.findById(item.meetingId).select('hostId');
            if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
            if (getHostId(meeting) !== getUserId(req)) {
                return res.status(403).json({ message: 'Only the meeting host can delete tasks' });
            }

            const meetingId = item.meetingId;
            await Task.findByIdAndDelete(req.params.id);
            broadcastSync(meetingId.toString());
            res.json({ message: 'Deleted' });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};

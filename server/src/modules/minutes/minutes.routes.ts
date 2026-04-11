import express from 'express';
const router = express.Router();
import Minutes = require('./minutes.schema');

export = function ({ protect, usingMongo, inMemoryMinutes, io, Minutes: DbMinutes }: any) {
    const broadcastSync = async (meetingId: string) => {
        if (!io) return;
        const mId = meetingId.toString();
        let items = [];
        if (usingMongo() && Minutes) {
            const doc = await Minutes.findOne({ meetingId: mId });
            items = doc ? (doc as any).items : [];
        } else {
            items = inMemoryMinutes[mId] || [];
        }
        io.to(`meeting:${mId}`).emit('minutes_sync', { meetingId: mId, items });
    };

    router.get('/:meetingId', protect, async (req: any, res: any) => {
        try {
            if (usingMongo() && Minutes) {
                const doc = await Minutes.findOne({ meetingId: req.params.meetingId });
                if (doc) return res.json((doc as any).items);
            }
            res.json(inMemoryMinutes[req.params.meetingId] || []);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.post('/:meetingId', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo()) {
                const { items } = req.body;
                inMemoryMinutes[req.params.meetingId] = items || [];
                broadcastSync(req.params.meetingId);
                return res.json(items || []);
            }

            const { items } = req.body;
            const doc = await Minutes.findOneAndUpdate(
                { meetingId: req.params.meetingId },
                { meetingId: req.params.meetingId, items: items || [], createdBy: req.user.id },
                { upsert: true, new: true }
            );
            broadcastSync(req.params.meetingId);
            res.json((doc as any).items);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.post('/:meetingId/items', protect, async (req: any, res: any) => {
        try {
            const { title, duration } = req.body;
            const newItem: any = {
                id: `mn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                title: title || 'New Item',
                duration: duration || 10,
                status: 'pending',
                notes: '',
                order: 0,
            };

            if (!usingMongo()) {
                if (!inMemoryMinutes[req.params.meetingId]) inMemoryMinutes[req.params.meetingId] = [];
                newItem.order = inMemoryMinutes[req.params.meetingId].length;
                inMemoryMinutes[req.params.meetingId].push(newItem);
                broadcastSync(req.params.meetingId);
                return res.status(201).json(newItem);
            }

            let doc = await Minutes.findOne({ meetingId: req.params.meetingId });
            if (!doc) {
                doc = await Minutes.create({ meetingId: req.params.meetingId, items: [], createdBy: req.user.id });
            }
            newItem.order = (doc as any).items.length;
            (doc as any).items.push(newItem);
            await doc.save();
            broadcastSync(req.params.meetingId);
            res.status(201).json(newItem);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.put('/:meetingId/items/:itemId', protect, async (req: any, res: any) => {
        try {
            const { status, notes, title, duration } = req.body;

            if (!usingMongo()) {
                const items = inMemoryMinutes[req.params.meetingId];
                if (!items) return res.status(404).json({ message: 'Minutes not found' });
                const item = items.find((i: any) => i.id === req.params.itemId);
                if (!item) return res.status(404).json({ message: 'Item not found' });
                if (status !== undefined) item.status = status;
                if (notes !== undefined) item.notes = notes;
                if (title !== undefined) item.title = title;
                if (duration !== undefined) item.duration = duration;
                broadcastSync(req.params.meetingId);
                return res.json(item);
            }

            const doc = await Minutes.findOne({ meetingId: req.params.meetingId });
            if (!doc) return res.status(404).json({ message: 'Minutes not found' });

            const item = (doc as any).items.find((i: any) => i.id === req.params.itemId);
            if (!item) return res.status(404).json({ message: 'Item not found' });

            if (status !== undefined) item.status = status;
            if (notes !== undefined) item.notes = notes;
            if (title !== undefined) item.title = title;
            if (duration !== undefined) item.duration = duration;
            if (status === 'active') item.startedAt = new Date();
            if (status === 'completed') item.completedAt = new Date();

            await doc.save();
            broadcastSync(req.params.meetingId);
            res.json(item);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};

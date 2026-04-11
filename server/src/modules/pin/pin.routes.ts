import express from 'express';
const router = express.Router();
import ResourcePin = require('./pin.schema');

export = function ({ protect, usingMongo }: any) {

    router.get('/:meetingId', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo()) return res.json([]);
            const pins = await ResourcePin.find({ meetingId: req.params.meetingId })
                .populate('userId', 'name')
                .sort({ createdAt: 1 });
            res.json(pins.map((p: any) => ({
                id: p._id, type: p.type, url: p.url, content: p.content,
                metadata: p.metadata, label: p.label,
                transcriptTimestamp: p.transcriptTimestamp,
                agendaItemId: p.agendaItemId,
                user: p.userId?.name || 'Unknown',
                createdAt: p.createdAt,
            })));
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.post('/:meetingId', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo()) return res.status(400).json({ message: 'Database required' });

            const { type, url, content, metadata, label, transcriptTimestamp, agendaItemId } = req.body;
            const pin = await ResourcePin.create({
                meetingId: req.params.meetingId,
                userId: req.user.id,
                type: type || 'url',
                url: url || null,
                content: content || null,
                metadata: metadata || {},
                label: label || '',
                transcriptTimestamp: transcriptTimestamp || null,
                agendaItemId: agendaItemId || null,
            });
            res.status(201).json({
                id: pin._id, type: pin.type, url: pin.url, content: pin.content,
                metadata: pin.metadata, label: pin.label,
                transcriptTimestamp: pin.transcriptTimestamp,
                agendaItemId: pin.agendaItemId,
                user: 'You', createdAt: pin.createdAt,
            });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.delete('/:id', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo()) return res.status(400).json({ message: 'Database required' });
            const pin = await ResourcePin.findById(req.params.id);
            if (!pin) return res.status(404).json({ message: 'Pin not found' });
            if ((pin as any).userId.toString() !== req.user.id.toString()) {
                return res.status(403).json({ message: 'Not authorized' });
            }
            await ResourcePin.findByIdAndDelete(req.params.id);
            res.json({ message: 'Deleted' });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};

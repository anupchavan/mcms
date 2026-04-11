import express from 'express';
const router = express.Router();

export = function ({ Notification, protect, usingMongo }: any) {

    router.get('/', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo() || !Notification) return res.json([]);
            const notifs = await Notification.find({ userId: req.user.id })
                .sort({ createdAt: -1 }).limit(50)
                .populate('meetingId', 'title');
            res.json(notifs);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.patch('/:id/read', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo() || !Notification) return res.json({ success: true });
            await Notification.findByIdAndUpdate(req.params.id, { read: true });
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.patch('/read-all', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo() || !Notification) return res.json({ success: true });
            await Notification.updateMany({ userId: req.user.id, read: false }, { read: true });
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};

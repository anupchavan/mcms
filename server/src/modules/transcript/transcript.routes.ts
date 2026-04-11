import express from 'express';
const router = express.Router();
import Transcript = require('./transcript.schema');

export = function ({ protect, usingMongo, inMemoryTranscripts }: any) {

    router.get('/:meetingId', protect, async (req: any, res: any) => {
        try {
            if (usingMongo() && Transcript) {
                const docs = await Transcript.find({ meetingId: req.params.meetingId }).sort({ startTime: 1, createdAt: 1 });
                if (docs.length) {
                    return res.json(docs.map((d: any) => ({
                        id: d._id,
                        speaker: d.speaker,
                        speakerImage: d.speakerImage,
                        text: d.text,
                        timestamp: d.timestamp,
                        startTime: d.startTime,
                        languageCode: d.languageCode,
                        sentiment: d.sentiment,
                        agendaItemId: d.agendaItemId,
                    })));
                }
            }
            res.json(inMemoryTranscripts[req.params.meetingId] || []);
        } catch (err: any) {
            res.status(500).json({ message: 'Server error', error: err.message });
        }
    });

    return router;
};

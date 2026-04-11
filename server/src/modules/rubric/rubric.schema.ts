import mongoose from 'mongoose';

const scoreSchema = new mongoose.Schema({
    criterionIndex: { type: Number, required: true },
    score: { type: Number, required: true },
    comment: { type: String, default: '' },
    transcriptTimestamp: { type: String, default: null },
}, { _id: false });

const evaluationSchema = new mongoose.Schema({
    participantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    participantName: { type: String, default: '' },
    scores: [scoreSchema],
}, { _id: false });

const criterionSchema = new mongoose.Schema({
    name: { type: String, required: true },
    maxScore: { type: Number, default: 10 },
    description: { type: String, default: '' },
}, { _id: false });

const rubricSchema = new mongoose.Schema({
    meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, unique: true },
    criteria: [criterionSchema],
    evaluations: [evaluationSchema],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
    timestamps: true,
});

export = mongoose.model('Rubric', rubricSchema);

import mongoose from 'mongoose';

const meetingSummarySchema = new mongoose.Schema({
	meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, unique: true, index: true },
	overview: { type: String, default: '' },
	discussionPoints: [{ type: String }],
	completedItems: [{ type: String }],
	pendingItems: [{ type: String }],
	decisions: [{ type: String }],
	nextSteps: [{ type: String }],
	model: { type: String, default: 'unknown' },
	generatedAt: { type: Date, default: Date.now },
}, {
	timestamps: true,
});

export = mongoose.model('MeetingSummary', meetingSummarySchema);

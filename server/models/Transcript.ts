import mongoose from 'mongoose';

const transcriptSchema = new mongoose.Schema({
	meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },
	agendaItemId: { type: String, default: null },
	speaker: { type: String, default: 'Unknown' },
	speakerImage: { type: String, default: null },
	text: { type: String, required: true },
	timestamp: { type: String },
	startTime: { type: Number, default: null },
	endTime: { type: Number, default: null },
	sentiment: { type: String, enum: ['positive', 'neutral', 'negative', null], default: null },
	languageCode: { type: String, default: null },
}, {
	timestamps: true,
});

/** Sort / scan by meeting + time (createdAt is always set). */
transcriptSchema.index({ meetingId: 1, createdAt: 1 });
/** Filter archive transcript search by speaker within a meeting. */
transcriptSchema.index({ meetingId: 1, speaker: 1 });
/**
 * Single text index (MongoDB allows one per collection): meetingId prefix + text
 * for $text scoped to a meeting, and $text without meetingId for global archive/search.
 */
transcriptSchema.index({ meetingId: 1, text: 'text' });

export = mongoose.model('Transcript', transcriptSchema);

import mongoose from 'mongoose';

const resourcePinSchema = new mongoose.Schema({
	meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true },
	agendaItemId: { type: String, default: null },
	userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
	type: { type: String, enum: ['url', 'pdf', 'code'], default: 'url' },
	url: { type: String, default: null },
	content: { type: String, default: null },
	metadata: {
		pageNumber: { type: Number, default: null },
		lineNumber: { type: Number, default: null },
		language: { type: String, default: null },
	},
	transcriptTimestamp: { type: String, default: null },
	label: { type: String, default: '' },
}, {
	timestamps: true,
});

/** Meeting resource views read pins in creation order. */
resourcePinSchema.index({ meetingId: 1, createdAt: 1 });

export = mongoose.model('ResourcePin', resourcePinSchema);

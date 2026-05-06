import mongoose from 'mongoose';

const pollSchema = new mongoose.Schema({
	meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true },
	slots: [{
		date: { type: String, required: true },
		time: { type: String, required: true },
		votes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
	}],
	status: { type: String, default: 'active', enum: ['active', 'resolved'] },
	resolvedSlot: { type: Number, default: null },
}, {
	timestamps: true
});

/** Routes treat poll as one-to-one with meeting. */
pollSchema.index({ meetingId: 1 }, { unique: true });

export = mongoose.model('Poll', pollSchema);

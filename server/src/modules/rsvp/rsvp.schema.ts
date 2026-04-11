import mongoose from 'mongoose';

const rsvpSchema = new mongoose.Schema({
    meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    response: { type: String, required: true, enum: ['yes', 'no', 'maybe'] },
    respondedAt: { type: Date, default: Date.now },
}, {
    timestamps: true
});

rsvpSchema.index({ meetingId: 1, userId: 1 }, { unique: true });

export = mongoose.model('RSVP', rsvpSchema);

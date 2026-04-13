import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema({
    meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    method: { type: String, enum: ['qr', 'manual', 'auto'], default: 'auto' },
    joinTimestamp: { type: Date, default: Date.now },
    leaveTimestamp: { type: Date, default: null },
    punctual: { type: Boolean, default: null },
    qrToken: { type: String, default: null },
    /** Cumulative seconds the mic was open with voice activity (client VAD), per meeting. */
    speakingSecondsTotal: { type: Number, default: 0 },
}, {
    timestamps: true,
});

attendanceSchema.index({ meetingId: 1, userId: 1 }, { unique: true });
/** Dashboard history scans attendance by user in chronological order. */
attendanceSchema.index({ userId: 1, joinTimestamp: 1 });

export = mongoose.model('Attendance', attendanceSchema);

import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true, enum: [
        'poll_invite', 'meeting_confirmed', 'rsvp_update',
        'attendance_marked', 'action_item_assigned', 'brief_ready',
        'meeting_summary_ready', 'rubric_score',
        'action_item_completion_submitted', 'action_item_verified',
        'action_item_rejected',
    ] },
    meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
}, {
    timestamps: true
});

/** Notification center loads one user's newest notifications first. */
notificationSchema.index({ userId: 1, createdAt: -1 });
/** Bulk mark-as-read updates filter by user and unread state. */
notificationSchema.index({ userId: 1, read: 1 });

export = mongoose.model('Notification', notificationSchema);

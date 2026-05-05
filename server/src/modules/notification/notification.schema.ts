import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true, enum: [
        'poll_invite', 'meeting_confirmed', 'rsvp_update',
        'meeting_invite', 'attendance_marked', 'brief_ready',
        'meeting_summary_ready', 'rubric_score',
        // Canonical task notification types.
        'task_assigned', 'task_completion_submitted', 'task_verified',
        'task_rejected', 'task_feedback',
        // Legacy `action_item_*` types preserved so existing notifications in the DB still load.
        'action_item_assigned', 'action_item_completion_submitted', 'action_item_verified',
        'action_item_rejected', 'action_item_feedback',
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

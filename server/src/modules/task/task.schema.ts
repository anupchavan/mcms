import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
    meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true },
    agendaItemId: { type: String, default: null },
    title: { type: String, required: true },
    /** Canonical multi-assignee list. Empty = unassigned. */
    assignees: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    /** Legacy single-assignee fields. Reads still expose `assignee` for back-compat;
     * new writes should populate `assignees`. */
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assigneeName: { type: String, default: null },
    category: {
        type: String,
        enum: ['Technical', 'Administrative', 'Decision', 'Follow-up'],
        default: 'Technical',
    },
    status: {
        type: String,
        enum: ['draft', 'pending', 'in-progress', 'completed', 'verified', 'missing'],
        default: 'pending',
    },
    completionSubmittedAt: { type: Date, default: null },
    verifiedAt: { type: Date, default: null },
    hostFeedback: { type: String, default: null },
    deadline: { type: String, default: null },
    source: { type: String, enum: ['manual', 'ai-extracted'], default: 'manual' },
    aiConfidence: { type: Number, default: null },
}, {
    timestamps: true,
});

/** Meeting task views read one meeting's items in creation order. */
taskSchema.index({ meetingId: 1, createdAt: 1 });
/** Legacy single-assignee index — kept for back-compat reads. */
taskSchema.index({ assignee: 1, deadline: 1 });
/** "My tasks" filters by any of the assignees and sorts by deadline. */
taskSchema.index({ assignees: 1, deadline: 1 });
/** Brief generation pulls recent pending / in-progress items globally. */
taskSchema.index({ status: 1, createdAt: -1 });

/** Explicit collection mapping preserves the existing `actionitems` collection so the rename is non-breaking for stored data. */
export = mongoose.model('Task', taskSchema, 'actionitems');

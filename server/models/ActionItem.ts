import mongoose from 'mongoose';

const actionItemSchema = new mongoose.Schema({
    meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true },
    agendaItemId: { type: String, default: null },
    title: { type: String, required: true },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assigneeName: { type: String, default: null },
    category: {
        type: String,
        enum: ['Technical', 'Administrative', 'Decision', 'Follow-up'],
        default: 'Technical',
    },
    status: {
        type: String,
        enum: ['draft', 'pending', 'in-progress', 'completed', 'missing'],
        default: 'pending',
    },
    deadline: { type: String, default: null },
    source: { type: String, enum: ['manual', 'ai-extracted'], default: 'manual' },
    aiConfidence: { type: Number, default: null },
}, {
    timestamps: true,
});

/** Meeting action item views read one meeting's items in creation order. */
actionItemSchema.index({ meetingId: 1, createdAt: 1 });
/** "My tasks" filters by assignee and sorts by deadline. */
actionItemSchema.index({ assignee: 1, deadline: 1 });
/** Brief generation pulls recent pending / in-progress items globally. */
actionItemSchema.index({ status: 1, createdAt: -1 });

export = mongoose.model('ActionItem', actionItemSchema);

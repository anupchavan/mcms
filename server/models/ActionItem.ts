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

actionItemSchema.index({ meetingId: 1 });
actionItemSchema.index({ assignee: 1, status: 1 });

export = mongoose.model('ActionItem', actionItemSchema);

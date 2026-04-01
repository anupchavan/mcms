import mongoose from 'mongoose';
import type { Document } from 'mongoose';

interface IAgendaItem {
	id: string;
	title: string;
	description?: string;
	duration: number;
	status: 'pending' | 'in-progress' | 'completed' | 'skipped';
	startTime?: Date;
	endTime?: Date;
	speaker?: string;
	notes?: string;
}

interface IAgenda extends Document {
	meetingId: mongoose.Types.ObjectId;
	items: IAgendaItem[];
	totalDuration: number;
	createdAt: Date;
	updatedAt: Date;
}

const agendaItemSchema = new mongoose.Schema({
	id: { type: String, required: true },
	title: { type: String, required: true, maxlength: 200 },
	description: { type: String },
	duration: { type: Number, required: true },
	status: { type: String, enum: ['pending', 'in-progress', 'completed', 'skipped'], default: 'pending' },
	startTime: { type: Date },
	endTime: { type: Date },
	speaker: { type: String },
	notes: { type: String, default: '' }
}, { _id: false });

const agendaSchema = new mongoose.Schema({
	meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, unique: true },
	items: [agendaItemSchema],
	activeItemId: { type: String, default: null },
	createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
	timestamps: true,
});

/** Full-text on embedded item titles for search / archive filters. (meetingId already indexed via unique.) */
agendaSchema.index({ 'items.title': 'text' });

export = mongoose.model('Agenda', agendaSchema);

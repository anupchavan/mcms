import mongoose from 'mongoose';
import type { Document } from 'mongoose';

interface IMinutesItem {
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

interface IMinutes extends Document {
	meetingId: mongoose.Types.ObjectId;
	items: IMinutesItem[];
	createdAt: Date;
	updatedAt: Date;
}

const minutesItemSchema = new mongoose.Schema({
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

const minutesSchema = new mongoose.Schema({
	meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, unique: true },
	items: [minutesItemSchema],
	createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
	timestamps: true,
});

export = mongoose.model('Minutes', minutesSchema);

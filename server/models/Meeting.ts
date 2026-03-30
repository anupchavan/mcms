import mongoose from 'mongoose';
import type { Document } from 'mongoose';

interface IMeeting extends Document {
	title: string;
	modality: string;
	date?: string;
	time?: string;
	confirmedDate?: string;
	confirmedTime?: string;
	durationMinutes?: number;
	location?: string;
	host?: string;
	hostId?: mongoose.Types.ObjectId;
	participants: mongoose.Types.ObjectId[];
	pollId?: mongoose.Types.ObjectId;
	status: 'pending_poll' | 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
	jitsiUrl?: string;
	jitsiRoomName?: string;
	createdAt: Date;
	updatedAt: Date;
}

const meetingSchema = new mongoose.Schema({
	title: { type: String, required: true, maxlength: 100 },
	modality: { type: String, default: 'Online' },
	date: { type: String },
	time: { type: String },
	confirmedDate: { type: String },
	confirmedTime: { type: String },
	durationMinutes: { type: Number, default: 30 },
	location: { type: String, maxlength: 200 },
	host: { type: String },
	hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
	participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
	pollId: { type: mongoose.Schema.Types.ObjectId, ref: 'Poll' },
	status: { type: String, default: 'pending_poll', enum: ['pending_poll', 'scheduled', 'in-progress', 'completed', 'cancelled'] },
	jitsiUrl: { type: String },
	jitsiRoomName: { type: String },
}, {
	timestamps: true
});

export = mongoose.model('Meeting', meetingSchema);

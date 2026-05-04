import mongoose from 'mongoose';
import type { Document } from 'mongoose';
import { generateUniqueMeetingInviteSegment } from '../../utils/meetingInviteId';

interface IMeeting extends Document {
	/** Public URL segment `xxxx-xxxx` (separate from Mongo `_id`). */
	id?: string;
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
	isPersonalRoom?: boolean;
	personalRoomId?: string;
	tags?: string[];
	tagColors?: Map<string, string>;
	description?: string;
	/** Host-pinned chat message snapshot (live meeting). */
	pinnedChat?: {
		messageId: mongoose.Schema.Types.ObjectId;
		senderId: mongoose.Schema.Types.ObjectId;
		senderName: string;
		senderImage: string | null;
		text: string;
		sentAt: number;
	} | null;
	createdAt: Date;
	updatedAt: Date;
}

const meetingSchema = new mongoose.Schema({
	/**
	 * Public meeting id (`abcd-efgh`). Auto-generated on validate.
	 * Uses schema option `id: false` so Mongoose does not reserve the virtual `id` getter (`_id` hex).
	 */
	id: { type: String, unique: true, sparse: true, index: true },
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
	isPersonalRoom: { type: Boolean, default: false },
	personalRoomId: { type: String, default: null },
	tags: [{ type: String }],
	tagColors: { type: Map, of: String, default: {} },
	description: { type: String, default: '' },
	pinnedChat: {
		type: new mongoose.Schema(
			{
				messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage' },
				senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
				senderName: { type: String, required: true },
				senderImage: { type: String, default: null },
				text: { type: String, required: true },
				sentAt: { type: Number, required: true },
			},
			{ _id: false },
		),
		default: null,
	},
}, {
	timestamps: true,
	id: false,
});

meetingSchema.pre('validate', async function () {
	if (!this.id) {
		const Self = this.constructor as mongoose.Model<any>;
		this.id = await generateUniqueMeetingInviteSegment(async (candidate) => {
			const existing = await Self.exists({ id: candidate });
			return !!existing;
		});
	}
});

/** Completed-meeting lists sorted by recency (archives). */
meetingSchema.index({ status: 1, createdAt: -1 });
/** Full-text on titles for archive / global search (uses text index). */
meetingSchema.index({ title: 'text' });
/** Dashboard counts meetings owned by a user. */
meetingSchema.index({ hostId: 1 });
/** Dashboard counts meetings participated in by a user. */
meetingSchema.index({ participants: 1 });

export = mongoose.model('Meeting', meetingSchema);

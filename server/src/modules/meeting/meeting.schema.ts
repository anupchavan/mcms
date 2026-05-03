import mongoose from 'mongoose';
import type { Document } from 'mongoose';
import { generateUniqueShortId } from '../../utils/shortId';

interface IMeeting extends Document {
	shortId?: string;
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
	/** Host-pinned chat message snapshot (live meeting). */
	pinnedChat?: {
		messageId: mongoose.Types.ObjectId;
		senderId: mongoose.Types.ObjectId;
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
	 * Short URL-friendly identifier (`xxxx-xxxx`). Auto-generated on insert
	 * via the pre-validate hook below. Used for user-facing links like
	 * `/meetings/abcd-efgh`. Internal references continue to use `_id`.
	 */
	shortId: { type: String, unique: true, sparse: true, index: true },
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
	timestamps: true
});

meetingSchema.pre('validate', async function () {
	if (!this.shortId) {
		const Self = this.constructor as mongoose.Model<any>;
		this.shortId = await generateUniqueShortId(async (candidate) => {
			const existing = await Self.exists({ shortId: candidate });
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
/** Dashboard counts meetings a user participates in. */
meetingSchema.index({ participants: 1 });

export = mongoose.model('Meeting', meetingSchema);

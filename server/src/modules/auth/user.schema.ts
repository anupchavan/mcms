import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
	name: {
		type: String,
		required: true,
	},
	email: {
		type: String,
		required: true,
		unique: true,
		lowercase: true,
	},
	password: {
		type: String,
		required: true,
	},
	profileImage: {
		type: String,
		default: null,
	},
	profileImageBuffer: {
		type: Buffer,
		default: null,
		select: false,
	},
	profileImageMimeType: {
		type: String,
		default: null,
	},
	personalRoomId: {
		type: String,
		unique: true,
		sparse: true,
	},
	/** Meeting `ObjectId` hex order: first = top of archive pin list (client + search filter). */
	archivePinnedMeetingIds: {
		type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Meeting' }],
		default: [],
	},
	createdAt: {
		type: Date,
		default: Date.now,
	}
});

userSchema.pre('save', async function () {
	if (!this.isModified('password')) return;

	const salt = await bcrypt.genSalt(10);
	this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.matchPassword = async function (enteredPassword: string) {
	return await bcrypt.compare(enteredPassword, this.password);
};

export = mongoose.model('User', userSchema);

import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema(
	{
		meetingId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Meeting",
			required: true,
			index: true,
		},
		senderId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		senderName: { type: String, required: true },
		senderImage: { type: String, default: null },
		/** Normal chat text; empty for persisted join/leave ribbons. */
		text: { type: String, default: "" },
		sentAt: { type: Number, required: true },
		kind: {
			type: String,
			enum: ["message", "join", "leave"],
			default: "message",
		},
	},
	{ timestamps: true },
);

chatMessageSchema.index({ meetingId: 1, sentAt: 1 });

export = mongoose.model("ChatMessage", chatMessageSchema);

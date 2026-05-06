import express from "express";
const router = express.Router();

export = function ({
	protect,
	usingMongo,
	inMemoryChatMessages,
	inMemoryMeetingPinnedChat,
	ChatMessage,
	Meeting,
	inMemoryMeetings,
}: any) {
	function mapDoc(d: any) {
		const kind = d.kind || "message";
		return {
			id: d._id.toString(),
			meetingId: String(d.meetingId),
			senderId: String(d.senderId),
			senderName: d.senderName,
			senderImage: d.senderImage,
			text: d.text ?? "",
			timestamp: d.sentAt,
			...(kind !== "message" ? { system: kind } : {}),
		};
	}

	function mapPinnedClient(pc: any, meetingIdStr: string) {
		if (!pc) return null;
		return {
			id: String(pc.messageId),
			meetingId: meetingIdStr,
			senderId: String(pc.senderId),
			senderName: pc.senderName,
			senderImage: pc.senderImage ?? null,
			text: pc.text,
			timestamp: pc.sentAt,
		};
	}

	router.get("/:meetingId", protect, async (req: any, res: any) => {
		try {
			const paramId = req.params.meetingId;

			if (usingMongo() && ChatMessage && Meeting) {
				const meeting = await Meeting.findOne({
					$or: [{ _id: paramId }, { id: paramId }, { shortId: paramId }],
				})
					.select("_id pinnedChat")
					.lean();
				const mid = meeting?._id ?? paramId;
				const pinnedMeetingIdStr = meeting?._id != null ? String(meeting._id) : paramId;
				const pinned = meeting?.pinnedChat
					? mapPinnedClient(meeting.pinnedChat, pinnedMeetingIdStr)
					: null;
				const docs = await ChatMessage.find({ meetingId: mid }).sort({
					sentAt: 1,
					createdAt: 1,
				});
				return res.json({ messages: docs.map(mapDoc), pinned });
			}

			let pinned = inMemoryMeetingPinnedChat[paramId] ?? null;
			if (!pinned && Array.isArray(inMemoryMeetings)) {
				const m = inMemoryMeetings.find(
					(mm: any) =>
						String(mm.id || mm._id) === String(paramId) ||
						String(mm.shortId ?? '') === String(paramId),
				);
				if (m) {
					const mid = String(m.id || m._id);
					pinned = inMemoryMeetingPinnedChat[mid] ?? null;
				}
			}
			const rows = inMemoryChatMessages[paramId] || [];
			const messages = [...rows].sort(
				(a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0),
			);
			res.json({ messages, pinned });
		} catch (err: any) {
			res
				.status(500)
				.json({ message: "Server error", error: err.message });
		}
	});

	return router;
};

import mongoose from 'mongoose';

/**
 * Look up a meeting by public `id` (`xxxx-xxxx`) or Mongo `_id`.
 * Older bookmarks may still use ObjectId-shaped URLs.
 */
export async function findMeetingByAnyId(Meeting: any, idParam: string) {
    if (!idParam) return null;
    if (mongoose.isValidObjectId(idParam)) {
        return Meeting.findById(idParam);
    }
    return Meeting.findOne({
        $or: [{ id: idParam }, { shortId: idParam }],
    });
}

/**
 * Variant of `findMeetingByAnyId` that lets the caller chain `populate()`
 * when possible.
 */
export function meetingQueryByAnyId(Meeting: any, idParam: string) {
    if (!idParam) return null;
    if (mongoose.isValidObjectId(idParam)) {
        return Meeting.findById(idParam);
    }
    return Meeting.findOne({
        $or: [{ id: idParam }, { shortId: idParam }],
    });
}

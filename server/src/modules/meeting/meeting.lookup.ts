import mongoose from 'mongoose';
import { isShortId } from '../../utils/shortId';

/**
 * Look up a meeting by either its `shortId` (`xxxx-xxxx`) or its Mongo
 * ObjectId. Used by `GET /api/meetings/:id` and the personal-room lookup so
 * old ObjectId-based links keep working alongside the new short URLs.
 */
export async function findMeetingByAnyId(Meeting: any, id: string) {
    if (!id) return null;
    if (isShortId(id)) {
        return Meeting.findOne({ shortId: id });
    }
    if (mongoose.isValidObjectId(id)) {
        return Meeting.findById(id);
    }
    // Fall back to shortId for unknown formats — handles future ID schemes
    // without throwing, while still allowing the caller to 404 cleanly.
    return Meeting.findOne({ shortId: id });
}

/**
 * Variant of `findMeetingByAnyId` that lets the caller chain `populate()`
 * by returning the unevaluated query when possible.
 */
export function meetingQueryByAnyId(Meeting: any, id: string) {
    if (!id) return null;
    if (isShortId(id)) {
        return Meeting.findOne({ shortId: id });
    }
    if (mongoose.isValidObjectId(id)) {
        return Meeting.findById(id);
    }
    return Meeting.findOne({ shortId: id });
}

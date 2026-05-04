import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
const router = express.Router();

export = function ({ User, Meeting, protect, usingMongo, inMemoryUsers }: any) {

    // Store uploads in memory so they can be persisted to MongoDB.
    // This avoids relying on the ephemeral local filesystem (e.g. Render free tier).
    const avatarUpload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (_req: any, file: any, cb: any) => {
            if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) return cb(null, true);
            cb(new Error('Only JPEG, PNG, GIF, and WebP images are allowed'));
        },
    });

    router.put('/archive-pins', protect, async (req: any, res: any) => {
        try {
            const idsRaw = req.body?.meetingIds;
            if (!Array.isArray(idsRaw)) {
                return res.status(400).json({ message: 'meetingIds array required' });
            }
            const uniq: string[] = [];
            const seen = new Set<string>();
            for (const x of idsRaw) {
                const s = String(x ?? '').trim();
                if (!s || seen.has(s)) continue;
                seen.add(s);
                uniq.push(s);
                if (uniq.length > 200) return res.status(400).json({ message: 'Too many pinned meetings' });
            }

            if (usingMongo() && User && Meeting) {
                const mongoose = require('mongoose');
                const oids: any[] = [];
                for (const hex of uniq) {
                    if (!mongoose.isValidObjectId(hex)) {
                        return res.status(400).json({ message: `Invalid meeting id: ${hex}` });
                    }
                    const exists = await Meeting.exists({ _id: hex, status: 'completed' });
                    if (!exists) return res.status(400).json({ message: 'Meeting not found or not archived' });
                    oids.push(new mongoose.Types.ObjectId(hex));
                }
                await User.findByIdAndUpdate(req.user.id, { archivePinnedMeetingIds: oids });
                const fresh = await User.findById(req.user.id).select('archivePinnedMeetingIds').lean();
                return res.json({
                    archivePinnedMeetingIds: (fresh?.archivePinnedMeetingIds || []).map((x: any) => String(x)),
                });
            }

            const user = inMemoryUsers.find((u: any) => u._id === req.user.id);
            if (!user) return res.status(404).json({ message: 'User not found' });
            user.archivePinnedMeetingIds = [...uniq];
            res.json({ archivePinnedMeetingIds: user.archivePinnedMeetingIds });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.put('/name', protect, async (req: any, res: any) => {
        try {
            const { name } = req.body;
            if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' });
            if (usingMongo() && User) {
                const user = await User.findByIdAndUpdate(req.user.id, { name: name.trim() }, { new: true }).select('-password');
                return res.json({ name: user.name });
            }
            const user = inMemoryUsers.find((u: any) => u._id === req.user.id);
            if (!user) return res.status(404).json({ message: 'User not found' });
            user.name = name.trim();
            res.json({ name: user.name });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.put('/email', protect, async (req: any, res: any) => {
        try {
            const { email } = req.body;
            if (!email || !email.trim()) return res.status(400).json({ message: 'Email is required' });
            if (usingMongo() && User) {
                const existing = await User.findOne({ email: email.trim().toLowerCase(), _id: { $ne: req.user.id } });
                if (existing) return res.status(400).json({ message: 'Email already in use' });
                const user = await User.findByIdAndUpdate(req.user.id, { email: email.trim() }, { new: true }).select('-password');
                return res.json({ email: user.email });
            }
            const lower = email.trim().toLowerCase();
            const conflict = inMemoryUsers.find((u: any) => u._id !== req.user.id && u.email === lower);
            if (conflict) return res.status(400).json({ message: 'Email already in use' });
            const user = inMemoryUsers.find((u: any) => u._id === req.user.id);
            if (!user) return res.status(404).json({ message: 'User not found' });
            user.email = lower;
            res.json({ email: user.email });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.put('/password', protect, async (req: any, res: any) => {
        try {
            const { currentPassword, newPassword } = req.body;
            if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Both fields are required' });
            if (newPassword.length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters' });
            if (usingMongo() && User) {
                const user = await User.findById(req.user.id);
                if (!user) return res.status(404).json({ message: 'User not found' });
                const isMatch = await user.matchPassword(currentPassword);
                if (!isMatch) return res.status(401).json({ message: 'Current password is incorrect' });
                user.password = newPassword;
                await user.save();
                return res.json({ message: 'Password updated' });
            }
            const user = inMemoryUsers.find((u: any) => u._id === req.user.id);
            if (!user) return res.status(404).json({ message: 'User not found' });
            const isMatch = await bcrypt.compare(currentPassword, user.password);
            if (!isMatch) return res.status(401).json({ message: 'Current password is incorrect' });
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(newPassword, salt);
            res.json({ message: 'Password updated' });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    // Serve avatar image stored in MongoDB — no filesystem required.
    router.get('/avatar/:userId', async (req: any, res: any) => {
        try {
            if (!usingMongo() || !User) return res.status(404).send('Not found');
            const user = await User.findById(req.params.userId).select('+profileImageBuffer profileImageMimeType');
            if (!user?.profileImageBuffer) return res.status(404).send('Not found');
            res.set('Content-Type', user.profileImageMimeType || 'image/jpeg');
            res.set('Cache-Control', 'public, max-age=31536000, immutable');
            return res.send(user.profileImageBuffer);
        } catch {
            return res.status(404).send('Not found');
        }
    });

    router.post('/avatar', protect, (req: any, res: any) => {
        avatarUpload.single('avatar')(req, res, async (err: any) => {
            if (err) {
                const message = err instanceof multer.MulterError
                    ? (err.code === 'LIMIT_FILE_SIZE' ? 'Image must be under 5 MB' : err.message)
                    : err.message;
                return res.status(400).json({ message });
            }
            if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
            try {
                const profileImage = `/api/profile/avatar/${req.user.id}`;
                if (usingMongo() && User) {
                    await User.findByIdAndUpdate(req.user.id, {
                        profileImage,
                        profileImageBuffer: req.file.buffer,
                        profileImageMimeType: req.file.mimetype,
                    });
                } else {
                    const user = inMemoryUsers.find((u: any) => u._id === req.user.id);
                    if (user) {
                        user.profileImage = profileImage;
                        user.profileImageBuffer = req.file.buffer;
                        user.profileImageMimeType = req.file.mimetype;
                    }
                }
                res.json({ profileImage });
            } catch (error: any) {
                res.status(500).json({ message: 'Server error', error: error.message });
            }
        });
    });

    router.delete('/avatar', protect, async (req: any, res: any) => {
        try {
            if (usingMongo() && User) {
                await User.findByIdAndUpdate(req.user.id, {
                    profileImage: null,
                    profileImageBuffer: null,
                    profileImageMimeType: null,
                });
            } else {
                const user = inMemoryUsers.find((u: any) => u._id === req.user.id);
                if (user) {
                    user.profileImage = null;
                    user.profileImageBuffer = null;
                    user.profileImageMimeType = null;
                }
            }
            res.json({ message: 'Avatar removed' });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.delete('/account', protect, async (req: any, res: any) => {
        try {
            const { password } = req.body;
            if (!password) return res.status(400).json({ message: 'Password is required' });
            if (usingMongo() && User) {
                const user = await User.findById(req.user.id);
                if (!user) return res.status(404).json({ message: 'User not found' });
                const isMatch = await user.matchPassword(password);
                if (!isMatch) return res.status(401).json({ message: 'Incorrect password' });
                await User.findByIdAndDelete(req.user.id);
                return res.json({ message: 'Account deleted' });
            }
            const idx = inMemoryUsers.findIndex((u: any) => u._id === req.user.id);
            if (idx === -1) return res.status(404).json({ message: 'User not found' });
            const isMatch = await bcrypt.compare(password, inMemoryUsers[idx].password);
            if (!isMatch) return res.status(401).json({ message: 'Incorrect password' });
            inMemoryUsers.splice(idx, 1);
            res.json({ message: 'Account deleted' });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};

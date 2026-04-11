import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import bcrypt from 'bcryptjs';
const router = express.Router();

export = function ({ User, protect, usingMongo, inMemoryUsers }: any) {

    const avatarStorage = multer.diskStorage({
        destination: (_req: any, _file: any, cb: any) => cb(null, path.join(__dirname, '..', '..', 'uploads', 'avatars')),
        filename: (req: any, file: any, cb: any) => {
            const ext = path.extname(file.originalname);
            cb(null, `${req.user.id}-${Date.now()}${ext}`);
        },
    });
    const avatarUpload = multer({
        storage: avatarStorage,
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (_req: any, file: any, cb: any) => {
            if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) return cb(null, true);
            cb(new Error('Only JPEG, PNG, GIF, and WebP images are allowed'));
        },
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
                const profileImage = `/uploads/avatars/${req.file.filename}`;
                if (usingMongo() && User) {
                    const prev = await User.findById(req.user.id).select('profileImage');
                    if (prev?.profileImage) fs.unlink(path.join(__dirname, '..', '..', prev.profileImage), () => {});
                    await User.findByIdAndUpdate(req.user.id, { profileImage });
                } else {
                    const user = inMemoryUsers.find((u: any) => u._id === req.user.id);
                    if (user) user.profileImage = profileImage;
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
                const user = await User.findById(req.user.id).select('profileImage');
                if (user?.profileImage) {
                    fs.unlink(path.join(__dirname, '..', '..', user.profileImage), () => {});
                    await User.findByIdAndUpdate(req.user.id, { profileImage: null });
                }
            } else {
                const user = inMemoryUsers.find((u: any) => u._id === req.user.id);
                if (user) user.profileImage = null;
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
                if (user.profileImage) fs.unlink(path.join(__dirname, '..', '..', user.profileImage), () => {});
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

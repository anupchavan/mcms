import express from 'express';
import bcrypt from 'bcryptjs';
const router = express.Router();

export = function ({ User, protect, generateToken, usingMongo, inMemoryUsers }: any) {

    router.post('/register', async (req: any, res: any) => {
        try {
            const { name, email, password } = req.body;
            if (!name || !email || !password) {
                return res.status(400).json({ message: 'Please provide name, email, and password' });
            }

            if (usingMongo() && User) {
                let existing = await User.findOne({ email });
                if (existing) return res.status(400).json({ message: 'User already exists' });
                const user = await User.create({ name, email, password });
                return res.status(201).json({ _id: user._id, name: user.name, email: user.email, profileImage: user.profileImage, token: generateToken(user._id) });
            } else {
                const existing = inMemoryUsers.find((u: any) => u.email === email.toLowerCase());
                if (existing) return res.status(400).json({ message: 'User already exists' });
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(password, salt);
                const userId = `user_${Date.now()}`;
                const user = { _id: userId, name, email: email.toLowerCase(), password: hashedPassword };
                inMemoryUsers.push(user);
                return res.status(201).json({ _id: user._id, name: user.name, email: user.email, profileImage: null, token: generateToken(user._id) });
            }
        } catch (error: any) {
            console.error('Register error:', error);
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.post('/login', async (req: any, res: any) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({ message: 'Please provide email and password' });
            }

            if (usingMongo() && User) {
                const user = await User.findOne({ email });
                if (!user) return res.status(401).json({ message: 'Invalid email or password' });
                const isMatch = await user.matchPassword(password);
                if (!isMatch) return res.status(401).json({ message: 'Invalid email or password' });
                return res.json({ _id: user._id, name: user.name, email: user.email, profileImage: user.profileImage, token: generateToken(user._id) });
            } else {
                const user = inMemoryUsers.find((u: any) => u.email === email.toLowerCase());
                if (!user) return res.status(401).json({ message: 'Invalid email or password' });
                const isMatch = await bcrypt.compare(password, user.password);
                if (!isMatch) return res.status(401).json({ message: 'Invalid email or password' });
                return res.json({ _id: user._id, name: user.name, email: user.email, profileImage: user.profileImage || null, token: generateToken(user._id) });
            }
        } catch (error: any) {
            console.error('Login error:', error);
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.get('/me', protect, async (req: any, res: any) => {
        try {
            if (usingMongo() && User) {
                const user = await User.findById(req.user.id).select('-password');
                return res.json(user);
            }
            const user = inMemoryUsers.find((u: any) => u._id === req.user.id);
            res.json(user ? { _id: user._id, name: user.name, email: user.email, profileImage: user.profileImage || null } : null);
        } catch (error) {
            res.status(500).json({ message: 'Server error' });
        }
    });

    router.get('/search', protect, async (req: any, res: any) => {
        try {
            const q = (req.query.q || '').trim();
            if (!q || q.length < 2) return res.json([]);

            if (usingMongo() && User) {
                const regex = new RegExp(q, 'i');
                const users = await User.find({
                    $and: [
                        { _id: { $ne: req.user.id } },
                        { $or: [{ name: regex }, { email: regex }] }
                    ]
                }).select('name email').limit(10);
                return res.json(users);
            }

            const lower = q.toLowerCase();
            const results = inMemoryUsers
                .filter((u: any) => u._id !== req.user.id && (u.name.toLowerCase().includes(lower) || u.email.includes(lower)))
                .slice(0, 10)
                .map((u: any) => ({ _id: u._id, name: u.name, email: u.email }));
            res.json(results);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};

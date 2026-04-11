import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';

const protect = (req: Request, res: Response, next: NextFunction) => {
    let token: string | undefined;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'mcms_super_secret_key');
            
            // If MongoDB is active but the token is from an old memory session, violently reject it
            if (mongoose.connection.readyState === 1 && decoded.id && !/^[0-9a-fA-F]{24}$/.test(decoded.id)) {
                return res.status(401).json({ message: 'Session expired (switched to MongoDB). Please log in again.' });
            }
            
            (req as any).user = decoded;
            return next();
        } catch (error: any) {
            console.error('Token verification failed:', error.message);
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
    }

    return res.status(401).json({ message: 'Not authorized, no token' });
};

export { protect };

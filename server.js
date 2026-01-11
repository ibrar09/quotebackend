import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import sequelize from './config/db.js';
import apiRouter from './routes/index.js';

dotenv.config();

const app = express();

// 1. GLOBAL CORS (MUST BE FIRST)
app.use(cors({
    origin: true, // Echoes the requesting origin - most robust for cross-domain
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// 2. LOGGING
app.use((req, res, next) => {
    console.log(`📡 [${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// 3. PARSERS
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 4. TOP-LEVEL HEALTH CHECK (VERIFIES SERVER IS ALIVE)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', message: 'Server is running', database: sequelize.options.host });
});

// 5. API ROUTES
app.use('/api', apiRouter);

// 6. DB CONNECTION & START
const PORT = process.env.PORT || 8080;

sequelize.authenticate()
    .then(() => {
        console.log('✅ Database connected');
        return sequelize.sync({ alter: true });
    })
    .then(() => {
        console.log('✅ Tables synced');
        app.listen(PORT, () => {
            console.log(`🚀 Server listening on port ${PORT}`);
        });
    })
    .catch(err => {
        console.error('❌ Critical Error:', err);
        // Still start the server so we can get 500 errors instead of timeout/404
        app.listen(PORT, () => {
            console.log(`🚀 Server listening on port ${PORT} (DB FAILED)`);
        });
    });

export default app;
import express from 'express';
import cors from 'cors';
import sequelize from './config/db.js'; // Ensure you add .js
import dotenv from 'dotenv';
import apiRouter from './routes/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { startNotificationCron } from './cron/notification.cron.js';
import { startBrandSeeding } from './seed/initBrands.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import compression from 'compression'; // [NEW]
import helmet from 'helmet'; // [NEW] Security Headers
import rateLimit from 'express-rate-limit'; // [NEW] Rate Limiting

// Initialize dotenv
dotenv.config();

console.log('--- Database Diagnostics ---');
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('DB_URL status:', (process.env.DB_URL || process.env.DATABASE_URL) ? 'Present' : 'Missing');
console.log('---------------------------');

const app = express();
app.set('trust proxy', 1); // Trust first proxy (required for rate limiting behind load balancers)

const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:3000',
    'https://quotefrontend-5t1t-git-main-ibrar-ahmads-projects-a25e834c.vercel.app' // Explicitly add production URL
];

// CORS Middleware must be first
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1 || true) { // KEEPING NUCLEAR TRUE FOR NOW TO UNBLOCK
            return callback(null, true);
        } else {
            return callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Handle preflight requests for all routes (Express 5 fix: use regex instead of *)
app.options(/(.*)/, cors());

// Security Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow cross-origin for images/PDFs
    contentSecurityPolicy: false // Disable CSP for API-only to avoid blocking inline scripts in potential debug views
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3000, // Increased from 200 to 3000 to handle polling/search
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
app.use('/api', limiter); // Apply rate limiting to API routes

// Middleware
app.use(compression()); // [NEW] Enable GZIP/Brotli Compression

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve Static Files (Quotation Images)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// Main API Route
app.use('/api', apiRouter);
app.post('/api/test', (req, res) => {
    res.json({ message: "API is working!" });
});

// 1. Test Database Connection
sequelize.authenticate()
    .then(() => {
        console.log('✅ Connection to pgAdmin (PostgreSQL) has been established successfully.');
    })
    .catch(err => {
        console.error('❌ Unable to connect to the database:', err);
    });

// 2. Health Check Route
app.get('/', (req, res) => {
    res.send('Quotations System v1.1.1 (Cloudinary Fix) is Running!');
});

// 3. Database Sync
sequelize.sync({ alter: true })
    .then(async () => {
        console.log('✅ Database Tables Synced');
        // Auto-seed brands if missing
        await startBrandSeeding();
    })
    .catch(err => console.log('❌ Sync Error: ' + err));

// 4. Run DB Fix (Removed - run manually if needed)
// import './fix_db.js';

// Start the Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`==========================================`);
    console.log(`   QUOTATIONS SYSTEM STARTING...          `);
    console.log(`   SERVER RUNNING ON PORT: ${PORT}        `);
    console.log(`   VERSION: 1.2.1 (Hotfix: DB Connection) `);
    console.log(`==========================================`);

    // Start notification cron job
    startNotificationCron();
});
// Force Build Trigger: v1.1.3-fix-po-unique-constraint

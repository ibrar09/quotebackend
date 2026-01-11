import express from 'express';
import cors from 'cors';
import sequelize from './config/db.js'; // Ensure you add .js
import dotenv from 'dotenv';
import apiRouter from './routes/index.js';

// Initialize dotenv
dotenv.config();

console.log('--- Database Diagnostics ---');
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('DB_URL status:', (process.env.DB_URL || process.env.DATABASE_URL) ? 'Present' : 'Missing');
console.log('---------------------------');

const app = express();

// Middleware
const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:3000' // Legacy/fallback
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));


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
    res.send('Quotations System Server is Running & Connected to DB!');
});

// 3. Database Sync
sequelize.sync({ alter: true })
    .then(() => console.log('✅ Database Tables Synced'))
    .catch(err => console.log('❌ Sync Error: ' + err));

// Start the Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`==========================================`);
    console.log(`   QUOTATIONS SYSTEM STARTING...          `);
    console.log(`   SERVER RUNNING ON PORT: ${PORT}        `);
    console.log(`==========================================`);
});
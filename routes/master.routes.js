import express from 'express';
import multer from 'multer';
import csv from 'csv-parser';
import stream from 'stream';
import db from '../models/index.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const { Store, PriceList, sequelize } = db;

// Helper to clean price strings (e.g., "$1,200.50" -> 1200.50)
const parsePrice = (val) => {
    if (!val) return 0;
    const cleaned = String(val).replace(/[^0-9.-]+/g, "");
    return parseFloat(cleaned) || 0;
};

// 1. UPLOAD MASTER STORES
router.post('/upload-stores', upload.single('file'), async (req, res) => {
    console.log('🚀 [STORES] Upload request received');
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const results = [];
    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    bufferStream
        .pipe(csv())
        .on('error', (err) => {
            console.error('❌ [STORES] CSV Parsing Error:', err);
            res.status(400).json({ error: 'Failed to parse CSV file.' });
        })
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            console.log(`📊 [STORES] Received CSV: ${results.length} rows.`);
            try {
                if (results.length === 0) {
                    return res.status(400).json({ error: 'CSV file is empty.' });
                }

                // Log headers and first row for debugging
                const safeHeaders = results.length > 0 ? Object.keys(results[0]) : [];
                console.log(`🔍 [STORES] CSV Headers Found: ${safeHeaders.join(', ')}`);
                if (results.length > 0) {
                    console.log('🔍 [STORES] First Row Sample:', JSON.stringify(results[0], null, 2));
                }

                const formatted = results.map(row => ({
                    oracle_ccid: row.oracle_ccid || row.CCID || row['Store CCID'] || row.ccid,
                    region: row.region || row.Region,
                    city: row.city || row.City,
                    mall: row.mall || row.Mall,
                    division: row.division || row.Division,
                    brand: row.brand || row.Brand,
                    store_name: row.store_name || row['Store Name'] || row.Name,
                    fm_supervisor: row.fm_supervisor || row.Supervisor || row['FM Supervisor'],
                    fm_manager: row.fm_manager || row.Manager || row['FM Manager'],
                    store_status: row.store_status || row.Status || 'ACTIVE'
                })).filter(r => r.oracle_ccid);

                console.log(`🧹 [STORES] Formatted ${formatted.length} valid rows out of ${results.length} total.`);

                if (formatted.length === 0) {
                    return res.status(400).json({
                        error: 'No valid rows found',
                        details: 'Could not map "oracle_ccid". Check your CSV headers.',
                        foundHeaders: safeHeaders
                    });
                }

                const transaction = await sequelize.transaction();

                await Store.bulkCreate(formatted, {
                    updateOnDuplicate: ['region', 'city', 'mall', 'division', 'brand', 'store_name', 'fm_supervisor', 'fm_manager', 'store_status'],
                    transaction
                });

                await transaction.commit();
                console.log('✅ [STORES] Database transaction committed');
                res.json({ message: `Successfully synced ${formatted.length} stores.`, count: formatted.length });
            } catch (error) {
                console.error('❌ [STORES] CSV Sync Error:', error);
                res.status(500).json({ error: 'Sync failed: ' + error.message });
            }
        });
});

// 2. UPLOAD PRICE LIST
router.post('/upload-pricelist', upload.single('file'), async (req, res) => {
    console.log('🚀 [PRICELIST] Upload request received');
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const results = [];
    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    bufferStream
        .pipe(csv())
        .on('error', (err) => {
            console.error('❌ [PRICELIST] CSV Parsing Error:', err);
            res.status(400).json({ error: 'Failed to parse CSV file.' });
        })
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            console.log(`📊 [PRICELIST] Received CSV: ${results.length} rows.`);
            try {
                if (results.length === 0) {
                    return res.status(400).json({ error: 'CSV file is empty.' });
                }

                const safeHeaders = results.length > 0 ? Object.keys(results[0]) : [];
                console.log(`🔍 [PRICELIST] CSV Headers Found: ${safeHeaders.join(', ')}`);

                const transaction = await sequelize.transaction();

                const formatted = results.map(row => {
                    const matPrice = parsePrice(row.material_price || row.Material || row['Material Price']);
                    const labPrice = parsePrice(row.labor_price || row.Labor || row['Labor Price']);
                    const total = parsePrice(row.total_price || row.Total || row['Total Price']) || (matPrice + labPrice);
                    return {
                        code: row.code || row.Code || row['Item Code'],
                        description: row.description || row.Description || row.Item,
                        unit: row.unit || row.Unit || row.UOM,
                        material_price: matPrice,
                        labor_price: labPrice,
                        total_price: total,
                        remarks: row.remarks || row.Remarks
                    };
                }).filter(r => r.code);

                console.log(`🧹 [PRICELIST] Formatted ${formatted.length} valid rows out of ${results.length} total.`);

                if (formatted.length === 0) {
                    await transaction.rollback();
                    return res.status(400).json({
                        error: 'No valid rows found',
                        details: 'Could not map "code". Check your CSV headers.',
                        foundHeaders: safeHeaders
                    });
                }

                await PriceList.bulkCreate(formatted, {
                    updateOnDuplicate: ['description', 'unit', 'material_price', 'labor_price', 'total_price', 'remarks'],
                    transaction
                });

                await transaction.commit();
                console.log('✅ [PRICELIST] Database transaction committed');
                res.json({ message: `Successfully synced ${formatted.length} price items.`, count: formatted.length });
            } catch (error) {
                console.error('❌ [PRICELIST] Price List Sync Error:', error);
                res.status(500).json({ error: 'Sync failed: ' + error.message });
            }
        });
});

export default router;

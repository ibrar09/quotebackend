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
                const transaction = await sequelize.transaction();

                // Cleanup and format data
                const formatted = results.map(row => ({
                    oracle_ccid: row.oracle_ccid || row.CCID || row['Store CCID'],
                    region: row.region || row.Region,
                    city: row.city || row.City,
                    mall: row.mall || row.Mall,
                    division: row.division || row.Division,
                    brand: row.brand || row.Brand,
                    store_name: row.store_name || row['Store Name'],
                    fm_supervisor: row.fm_supervisor || row.Supervisor,
                    fm_manager: row.fm_manager || row.Manager,
                    store_status: row.store_status || row.Status || 'ACTIVE'
                })).filter(r => r.oracle_ccid);

                console.log(`🧹 [STORES] Formatted ${formatted.length} valid rows.`);

                await Store.bulkCreate(formatted, {
                    updateOnDuplicate: ['region', 'city', 'mall', 'division', 'brand', 'store_name', 'fm_supervisor', 'fm_manager', 'store_status'],
                    transaction
                });

                await transaction.commit();
                console.log('✅ [STORES] Database transaction committed');
                res.json({ message: `Successfully synced ${formatted.length} stores.` });
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
                const transaction = await sequelize.transaction();

                const formatted = results.map(row => {
                    const matPrice = parsePrice(row.material_price || row.Material);
                    const labPrice = parsePrice(row.labor_price || row.Labor);
                    const total = parsePrice(row.total_price || row.Total) || (matPrice + labPrice);
                    return {
                        code: row.code || row.Code,
                        description: row.description || row.Description,
                        unit: row.unit || row.Unit,
                        material_price: matPrice,
                        labor_price: labPrice,
                        total_price: total,
                        remarks: row.remarks || row.Remarks
                    };
                }).filter(r => r.code);

                console.log(`🧹 [PRICELIST] Formatted ${formatted.length} valid rows.`);

                await PriceList.bulkCreate(formatted, {
                    updateOnDuplicate: ['description', 'unit', 'material_price', 'labor_price', 'total_price', 'remarks'],
                    transaction
                });

                await transaction.commit();
                console.log('✅ [PRICELIST] Database transaction committed');
                res.json({ message: `Successfully synced ${formatted.length} price items.` });
            } catch (error) {
                console.error('❌ [PRICELIST] Price List Sync Error:', error);
                res.status(500).json({ error: 'Sync failed: ' + error.message });
            }
        });
});

export default router;

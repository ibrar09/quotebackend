import express from 'express';
import multer from 'multer';
import csv from 'csv-parser';
import stream from 'stream';
import moment from 'moment';
import db from '../models/index.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const { Store, PriceList, sequelize } = db;

// Helper to clean price strings (e.g., "$1,200.50" -> 1200.50)
const parsePrice = (val) => {
    if (!val || val === '#N/A') return 0;
    const cleaned = String(val).replace(/[^0-9.-]+/g, "");
    return parseFloat(cleaned) || 0;
};

const parseDate = (val) => {
    if (!val || val === '#N/A' || String(val).trim() === '') return null;
    const m = moment(val, ['MM/DD/YYYY', 'M/D/YYYY', 'DD-MMM-YYYY', 'YYYY-MM-DD'], true);
    return m.isValid() ? m.format('YYYY-MM-DD') : null;
};

// --- UNIVERSAL HEADER MAPPER ---
const cleanHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const matchHeader = (headers, aliases) => {
    const cleanedHeaders = headers.map(cleanHeader);
    for (const alias of aliases) {
        const cleanedAlias = cleanHeader(alias);
        const idx = cleanedHeaders.indexOf(cleanedAlias);
        if (idx !== -1) return idx;
    }
    // Partial Match Fallback
    for (const alias of aliases) {
        const cleanedAlias = cleanHeader(alias);
        const idx = cleanedHeaders.findIndex(h => h.includes(cleanedAlias) || cleanedAlias.includes(h));
        if (idx !== -1 && cleanedHeaders[idx].length > 2) return idx;
    }
    return -1;
};

const getRowValue = (row, headers, aliases) => {
    const idx = matchHeader(headers, aliases);
    return idx !== -1 ? row[idx] : null;
};


// 1. UPLOAD MASTER STORES
router.post('/upload-stores', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const results = [];
    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    bufferStream
        .pipe(csv({
            headers: false
        }))
        .on('data', (data) => results.push(Object.values(data)))
        .on('end', async () => {
            console.log(`Parsed ${results.length} raw rows from CSV (Stores).`);
            if (results.length > 0) {
                console.log('Sample Row 0:', results[0]);
                console.log('Sample Row 1:', results[1]);
                console.log('Sample Row 2:', results[2]);
            }

            try {
                // Find the header row using smart mapping
                let headerIndex = -1;
                const storeAliases = {
                    oracle_ccid: ['oracle_ccid', 'ccid', 'store_ccid', 'oracle_id', 'id', 'store_id'],
                    brand: ['brand', 'label', 'concept']
                };

                for (let i = 0; i < Math.min(results.length, 25); i++) {
                    const row = results[i].map(v => cleanHeader(v));
                    const hasCCID = storeAliases.oracle_ccid.some(a => row.includes(cleanHeader(a)));
                    const hasBrand = storeAliases.brand.some(a => row.includes(cleanHeader(a)));

                    if (hasCCID || (hasBrand && row.length > 5)) {
                        headerIndex = i;
                        console.log(`Smart Header Match for Stores found at row ${i}:`, results[i]);
                        break;
                    }
                }

                if (headerIndex === -1 && results.length > 0) {
                    return res.status(400).json({ error: 'Could not find header row (Oracle CCID, Brand) in Stores CSV. Please check columns.' });
                }

                if (results.length === 0) return res.json({ message: 'CSV is empty' });

                const headers = results[headerIndex].map(h => String(h).trim());
                console.log('Detected Stores Headers:', headers);

                const dataRows = results.slice(headerIndex + 1);
                const transaction = await sequelize.transaction();

                // Advanced Mapper Alias Dictionaries
                const aliases = {
                    oracle_ccid: ['oracle_ccid', 'ccid', 'store_ccid', 'oracle_id', 'id', 'store_id', 'ccid_number'],
                    region: ['region', 'area', 'zone'],
                    city: ['city', 'location', 'town'],
                    mall: ['mall', 'site', 'centre', 'center', 'complex', 'site_name'],
                    division: ['division', 'business_unit', 'bu', 'sector'],
                    brand: ['brand', 'label', 'concept'],
                    store_name: ['store_name', 'name', 'shop_name', 'branch'],
                    fm_supervisor: ['fm_supervisor', 'supervisor', 'fs', 'fs_new', 'area_supervisor', 'fm_supervisor'],
                    fm_manager: ['fm_manager', 'manager', 'fm', 'area_manager', 'fm_manager'],
                    sqm: ['sqm', 'size', 'area', 'sqm_area', 'space'],
                    store_status: ['store_status', 'status', 'state'],
                    store_type: ['store_type', 'type', 'format'],
                    opening_date: ['opening_date', 'open_date', 'opened']
                };
                // Note: fm_supervisor and fm_manager sometimes have weird spaces in CSV

                const formatted = dataRows.map(row => ({
                    oracle_ccid: getRowValue(row, headers, aliases.oracle_ccid),
                    region: getRowValue(row, headers, aliases.region),
                    city: getRowValue(row, headers, aliases.city),
                    mall: getRowValue(row, headers, aliases.mall),
                    division: getRowValue(row, headers, aliases.division),
                    brand: getRowValue(row, headers, aliases.brand),
                    store_name: getRowValue(row, headers, aliases.store_name),
                    fm_supervisor: getRowValue(row, headers, aliases.fm_supervisor),
                    fm_manager: getRowValue(row, headers, aliases.fm_manager),
                    sqm: parsePrice(getRowValue(row, headers, aliases.sqm)),
                    store_status: getRowValue(row, headers, aliases.store_status) || 'ACTIVE',
                    store_type: getRowValue(row, headers, aliases.store_type),
                    opening_date: parseDate(getRowValue(row, headers.map(h => h.replace('\n', ' ')), aliases.opening_date))
                })).filter(r => r.oracle_ccid);

                console.log(`Formatted ${formatted.length} stores for database insert.`);
                if (formatted.length > 0) {
                    console.log('Stores Mapping Sample (Row 1):', {
                        original: dataRows[0],
                        formatted: formatted[0]
                    });
                }

                await Store.bulkCreate(formatted, {
                    updateOnDuplicate: ['region', 'city', 'mall', 'division', 'brand', 'store_name', 'fm_supervisor', 'fm_manager', 'sqm', 'store_status', 'store_type', 'opening_date'],
                    transaction
                });

                await transaction.commit();
                res.json({ message: `Successfully synced ${formatted.length} stores.` });
            } catch (error) {
                console.error('CSV Sync Error:', error);
                res.status(500).json({ error: 'Sync failed: ' + error.message });
            }
        });
});

// 2. UPLOAD PRICE LIST
router.post('/upload-pricelist', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const results = [];
    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    bufferStream
        .pipe(csv({
            headers: false // Read raw rows to find the actual header row
        }))
        .on('data', (data) => results.push(Object.values(data)))
        .on('end', async () => {
            console.log(`Parsed ${results.length} raw rows from CSV (PriceList).`);
            if (results.length > 0) {
                console.log('Sample Row 0:', results[0]);
                console.log('Sample Row 1:', results[1]);
                console.log('Sample Row 2:', results[2]);
            }

            try {
                const aliases = {
                    code: ['code', 'item_code', 'part_number', 'sku', 'id', 'item_id', 'service_code', 'serial_no', 'sr_no', 'sl_no'],
                    type: ['type', 'category', 'group', 'class', 'item_type', 'service_type'],
                    description: ['description', 'decription', 'details', 'item_description', 'specification', 'item_name', 'item', 'name', 'work_description', 'task_description', 'scope_of_work', 'service_description', 'material_description'],
                    unit: ['unit', 'uom', 'measure', 'qty_unit'],
                    material_price: ['material_price', 'material', 'materials', 'mat_price', 'supply', 'unit_price', 'rate', 'unit_rate'],
                    labor_price: ['labor_price', 'labor', 'labour', 'lab_price', 'installation', 'fitting'],
                    total_price: ['total_price', 'total', 'grand_total', 'total_amount', 'sum'],
                    remarks: ['remarks', 'remark', 'note', 'notes'],
                    comments: ['comments', 'comment', 'internal_notes']
                };

                // Find the header row (using our smart alias matching)
                let headerIndex = -1;
                for (let i = 0; i < Math.min(results.length, 25); i++) {
                    const row = results[i].map(v => cleanHeader(v));
                    const hasCode = aliases.code.some(a => row.includes(cleanHeader(a)));
                    const hasDesc = aliases.description.some(a => row.includes(cleanHeader(a)));

                    if (hasCode && hasDesc) {
                        headerIndex = i;
                        console.log(`Smart Header Match found at row ${i}:`, results[i]);
                        break;
                    }
                }

                // Fallback: If no perfect match, just find 'Code' or something similar
                if (headerIndex === -1) {
                    for (let i = 0; i < Math.min(results.length, 10); i++) {
                        const row = results[i].map(v => cleanHeader(v));
                        if (aliases.code.some(a => row.includes(cleanHeader(a)))) {
                            headerIndex = i;
                            console.log(`Fallback Header Match (Code Only) at row ${i}:`, results[i]);
                            break;
                        }
                    }
                }

                if (headerIndex === -1) {
                    return res.status(400).json({ error: 'Could not find header row (Item Code, Description) in CSV. Please ensure your columns are named correctly.' });
                }

                const headers = results[headerIndex].map(h => String(h).trim());
                console.log('Detected PriceList Headers:', headers);

                const dataRows = results.slice(headerIndex + 1);
                const transaction = await sequelize.transaction();


                const formatted = dataRows.map(row => {
                    const matPrice = parsePrice(getRowValue(row, headers, aliases.material_price));
                    const labPrice = parsePrice(getRowValue(row, headers, aliases.labor_price));
                    const total = parsePrice(getRowValue(row, headers, aliases.total_price)) || (matPrice + labPrice);

                    return {
                        code: getRowValue(row, headers, aliases.code),
                        type: getRowValue(row, headers, aliases.type),
                        description: getRowValue(row, headers, aliases.description),
                        unit: getRowValue(row, headers, aliases.unit),
                        material_price: matPrice,
                        labor_price: labPrice,
                        total_price: total,
                        remarks: getRowValue(row, headers, aliases.remarks),
                        comments: getRowValue(row, headers, aliases.comments)
                    };
                }).filter(r => r.code);

                console.log(`Formatted ${formatted.length} PriceList items for database insert.`);
                if (formatted.length > 0) {
                    console.log('Mapping Sample (Row 1):', {
                        original: dataRows[0],
                        formatted: formatted[0]
                    });
                }

                await PriceList.bulkCreate(formatted, {
                    updateOnDuplicate: ['type', 'description', 'unit', 'material_price', 'labor_price', 'total_price', 'remarks', 'comments'],
                    transaction
                });

                await transaction.commit();
                res.json({ message: `Successfully synced ${formatted.length} price items.`, count: formatted.length });
            } catch (error) {
                console.error('Price List Sync Error:', error);
                res.status(500).json({ error: 'Sync failed: ' + error.message });
            }
        });
});

export default router;

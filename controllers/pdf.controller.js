import puppeteer from 'puppeteer';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import Job from '../models/job.js';
import { generateQuotationHTML } from '../utils/pdfTemplates/quotation.template.js';

// In-memory store for temporary previews (lasts until server restart)
const previewStore = new Map();

export const preparePreview = async (req, res) => {
    try {
        const previewId = uuidv4();
        // Backend template expects snake_case/DB structure, but frontend might send camelCase?
        // Let's assume frontend sends similar structure or we map it here if needed.
        // For now, storing raw body.
        previewStore.set(previewId, {
            data: req.body,
            createdAt: new Date()
        });

        // Cleanup old previews (older than 1 hour)
        const ONE_HOUR = 60 * 60 * 1000;
        for (const [id, entry] of previewStore.entries()) {
            if (new Date() - entry.createdAt > ONE_HOUR) {
                previewStore.delete(id);
            }
        }

        res.json({ success: true, previewId });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getPreviewData = async (req, res) => {
    const { id } = req.params;
    const entry = previewStore.get(id);
    if (!entry) return res.status(404).json({ success: false, message: 'Preview expired or not found' });
    res.json({ success: true, data: entry.data });
};

export const generatePdf = async (req, res) => {
    try {
        const { url, quotationId, previewId, title = 'QUOTATION' } = req.body;

        // 1. DATA SOURCE RESOLUTION
        // Use backend generation if ID is present, otherwise fallback to URL
        let pdfHTML = null;

        if (quotationId || previewId) {
            console.log(`[PDF] Generating via Backend Template for ID: ${quotationId || previewId}`);
            let quoteData = null;

            if (previewId) {
                const entry = previewStore.get(previewId);
                if (entry) quoteData = entry.data;
                // Ensure items array is consistent (frontend might send 'items' vs DB 'JobItems')
                if (quoteData && !quoteData.items && quoteData.JobItems) quoteData.items = quoteData.JobItems;
            }
            else if (quotationId) {
                console.log(`[PDF] Fetching Job ID: ${quotationId}`);
                const job = await Job.findByPk(quotationId, {
                    include: [{ all: true }] // Include Store/Items/Images
                });
                if (!job) throw new Error('Quotation not found');

                const jobJSON = job.toJSON();
                console.log('[PDF] Job Data loaded:', JSON.stringify(jobJSON, null, 2));

                // ---------------------------------------------------------
                // MAP DATA TO MATCH FRONTEND LOGIC (QuotationPrintView.jsx)
                // ---------------------------------------------------------

                // Process Images: Convert local /uploads paths OR remote URLs to Base64 for Puppeteer
                const processedImages = await Promise.all((jobJSON.JobImages || []).map(async (img) => {
                    let imagePath = img.file_path || '';
                    console.log(`[PDF] Processing Image: ${imagePath}`);

                    try {
                        // 1. Remote URL (Cloudinary / S3)
                        if (imagePath.startsWith('http')) {
                            // Use native fetch (Node 18+)
                            const response = await fetch(imagePath);
                            if (response.ok) {
                                const arrayBuffer = await response.arrayBuffer();
                                const buffer = Buffer.from(arrayBuffer);
                                const mime = response.headers.get('content-type') || 'image/jpeg';
                                return `data:${mime};base64,${buffer.toString('base64')}`;
                            } else {
                                console.warn(`[PDF] Failed to fetch remote image: ${response.statusText}`);
                            }
                        }
                        // 2. Local File System
                        // Handle various path formats: /uploads, uploads\, \uploads
                        else if (imagePath.includes('uploads')) {
                            // Normalize path to fix windows backslashes
                            const normalizedPath = imagePath.replace(/\\/g, '/');

                            // Construct absolute path using process.cwd()
                            // Assumption: 'uploads' folder is in root of backend
                            let finalPath = path.join(process.cwd(), normalizedPath.startsWith('/') ? normalizedPath.slice(1) : normalizedPath);

                            // If path doesn't start with 'uploads', assume it's just filename and append
                            if (!normalizedPath.includes('/')) {
                                finalPath = path.join(process.cwd(), 'uploads', normalizedPath);
                            }

                            console.log(`[PDF] Resolved Local Path: ${finalPath}`);

                            if (fs.existsSync(finalPath)) {
                                const fileData = fs.readFileSync(finalPath);
                                const ext = path.extname(finalPath).toLowerCase().replace('.', '');
                                const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
                                return `data:${mime};base64,${fileData.toString('base64')}`;
                            } else {
                                console.warn(`[PDF] Local file not found: ${finalPath}`);
                            }
                        }
                    } catch (err) {
                        console.warn(`[PDF] Failed to convert image ${imagePath} to base64:`, err.message);
                    }
                    return imagePath; // Fallback to original path/URL
                }));

                quoteData = {
                    ...jobJSON,
                    date: jobJSON.createdAt ? new Date(jobJSON.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                    attentionTo: jobJSON.Store?.fm_manager || jobJSON.Store?.fm_supervisor || jobJSON.attentionTo || '',
                    version: jobJSON.version || '1.0',
                    brand: jobJSON.brand || jobJSON.Store?.brand || '',
                    quote_no: jobJSON.quote_no || '',
                    validity: jobJSON.validity || '30 Days',
                    location: jobJSON.location || jobJSON.Store?.mall || '',
                    mr_no: jobJSON.mr_no || '',
                    mr_date: jobJSON.mr_date || '', // Frontend uses direct value
                    city: jobJSON.city || jobJSON.Store?.city || '',
                    oracle_ccid: jobJSON.oracle_ccid || '',
                    mr_priority: jobJSON.mr_priority || 'Normal',
                    work_description: jobJSON.work_description || '',
                    store_opening_date: jobJSON.store_opening_date || jobJSON.Store?.opening_date || '',
                    continuous_assessment: jobJSON.continuous_assessment || '',
                    items: jobJSON.JobItems || [],
                    images: processedImages,
                    completion_date: jobJSON.completion_date || '',
                    warranty: jobJSON.warranty || ''
                };

                // Load Assets (Stamp & Signature) from Frontend Directory if possible
                // Load Assets (Stamp & Signature)
                try {
                    // Use process.cwd() to resolve path relative to backend root
                    const assetPath = path.join(process.cwd(), 'assets');
                    console.log(`[PDF] Loading assets from: ${assetPath}`);

                    if (fs.existsSync(path.join(assetPath, 'stamp.jpeg'))) {
                        const stamp = fs.readFileSync(path.join(assetPath, 'stamp.jpeg'));
                        quoteData.stampBase64 = `data:image/jpeg;base64,${stamp.toString('base64')}`;
                    } else {
                        console.warn('[PDF] Stamp file missing:', path.join(assetPath, 'stamp.jpeg'));
                    }

                    if (fs.existsSync(path.join(assetPath, 'signature.jpeg'))) {
                        const sig = fs.readFileSync(path.join(assetPath, 'signature.jpeg'));
                        quoteData.signatureBase64 = `data:image/jpeg;base64,${sig.toString('base64')}`;
                    } else {
                        console.warn('[PDF] Signature file missing:', path.join(assetPath, 'signature.jpeg'));
                    }
                } catch (assetErr) {
                    console.warn('[PDF] Failed to load local assets:', assetErr.message);
                }

                console.log('[PDF] Final Mapped Data:', JSON.stringify(quoteData, null, 2));
            }

            if (!quoteData) throw new Error('Failed to retrieve data for PDF generation');

            // Generate HTML string
            pdfHTML = generateQuotationHTML(quoteData);
        }

        if (!url && !pdfHTML) {
            return res.status(400).send('Either URL or quotationId/previewId is required');
        }

        // 2. PUPPETEER LAUNCH
        const browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--font-render-hinting=none',
            ]
        });
        const page = await browser.newPage();

        // Build header template for REPETITION (This applies to both methods)
        let logoBase64 = '';
        try {
            logoBase64 = fs.readFileSync('./logo_base64.txt', 'utf-8').trim();
        } catch (err) {
            console.warn('[PDF] Logo file not found, header will show without logo');
        }

        const headerTemplate = `
            <div style="width: 100%; margin-left: 15mm; margin-right: 15mm; font-family: 'Outfit', sans-serif; font-size: 10px;">
                <div style="display: flex; justify-content: flex-end; align-items: center; border-bottom: 2px solid black; padding-bottom: 2px; margin-bottom: 4px;">
                    ${logoBase64 ? `<img src="${logoBase64}" alt="MAAJ Logo" style="height: 65px; object-fit: contain;" />` : ''}
                </div>
                <div style="background-color: #e2d1a5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; border: 2px solid black; padding: 4px 0; text-align: center; margin-bottom: 0;">
                    <h1 style="font-size: 18px; font-weight: bold; letter-spacing: 0.3em; color: black; text-transform: uppercase; margin: 0;">${title}</h1>
                </div>
            </div>
        `;

        // 🔹 Set a real User-Agent to avoid some bot-detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

        // 🔹 Debug: Log directly to console
        page.on('console', msg => console.log(`[PUPPETEER VM] ${msg.text()}`));
        page.on('pageerror', error => console.error(`[PUPPETEER VM ERROR] ${error.message}`));
        page.on('requestfailed', request => {
            const status = request.response()?.status();
            console.error(`[PUPPETEER REQ FAIL] [${status || 'ERR'}] ${request.url()} - ${request.failure()?.errorText || 'Failed'}`);
        });

        // Emulate screen media
        await page.emulateMediaType('screen');
        await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });

        // 3. RENDER CONTENT
        if (pdfHTML) {
            // BACKEND GENERATION: Set HTML directly
            await page.setContent(pdfHTML, { waitUntil: 'domcontentloaded' });
        } else {
            // LEGACY URL NAVIGATION
            console.log(`[PDF] Navigating to URL: ${url}`);
            // 🔹 Bypass Vercel Deployment Protection (if secret is in env)
            if (process.env.VERCEL_PROTECTION_BYPASS) {
                await page.setExtraHTTPHeaders({
                    'x-vercel-protection-bypass': process.env.VERCEL_PROTECTION_BYPASS
                });
            }

            // Navigate to the URL
            console.log(`[PDF] Navigating to ${url}...`);
            const response = await page.goto(url, {
                waitUntil: ['networkidle2', 'domcontentloaded'],
                timeout: 60000
            });

            // 🔹 1. Check for 401/403 (Standard Vercel block)
            if (response && (response.status() === 401 || response.status() === 403)) {
                throw new Error(`Access Denied (Status ${response.status()}). This Vercel deployment is private. Please disable "Deployment Protection" in Vercel Settings -> Security.`);
            }

            // 🔹 2. Broad Content Check for Vercel Login Wall
            const content = await page.content();
            const contentLower = content.toLowerCase();
            const isVercelWall =
                contentLower.includes('vercel.com') ||
                contentLower.includes('deployment protection') ||
                contentLower.includes('vercel_protection_bypass') ||
                content.includes('▲') || // Vercel logo ASCII
                (contentLower.includes('log in') && contentLower.includes('vercel'));

            if (isVercelWall && !contentLower.includes('quotation')) {
                throw new Error('Access Denied: Puppeteer hit the Vercel Login wall. You MUST disable "Deployment Protection" in your Vercel Dashboard for this to work.');
            }

            // 🔹 3. Wait for React to finish rendering
            try {
                console.log('[PDF] Waiting for selector #pdf-ready...');
                await page.waitForSelector('#pdf-ready', { timeout: 15000 });
            } catch (e) {
                console.error(`[PDF] Timeout waiting for #pdf-ready selector. Proceeding anyway, but PDF might be incomplete.`);
            }
        }

        // 4. GENERATE PDF
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: headerTemplate,
            footerTemplate: '<div></div>',
            margin: {
                top: '35mm',      // Header space
                bottom: '15mm',
                left: '15mm',
                right: '15mm'
            },
            preferCSSPageSize: true
        });

        await browser.close();
        console.log('[PDF] Generated successfully.');

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Length': pdfBuffer.length,
        });

        res.send(pdfBuffer);

    } catch (error) {
        console.error('❌ PDF Generation Error:', error);

        // DEBUG: Write to file since console is not showing
        try {
            fs.writeFileSync('./pdf_error_log.txt', `[${new Date().toISOString()}] ERROR: ${error.message}\nSTACK: ${error.stack}\n`);
        } catch (e) {
            console.error('Failed to write error log');
        }

        res.status(500).json({
            error: 'Failed to generate PDF',
            details: error.message
        });
    }
};

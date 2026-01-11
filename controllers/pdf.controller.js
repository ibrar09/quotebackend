import puppeteer from 'puppeteer';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// In-memory store for temporary previews (lasts until server restart)
const previewStore = new Map();

export const preparePreview = async (req, res) => {
    try {
        const previewId = uuidv4();
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
        const { url } = req.body;

        if (!url) {
            return res.status(400).send('URL is required');
        }

        console.log(`Generating PDF for URL: ${url}`);

        // Launch browser with more robust args for container environments
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

        // 🔹 Set a real User-Agent to avoid some bot-detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

        // 🔹 Bypass Vercel Deployment Protection (if secret is in env)
        if (process.env.VERCEL_PROTECTION_BYPASS) {
            await page.setExtraHTTPHeaders({
                'x-vercel-protection-bypass': process.env.VERCEL_PROTECTION_BYPASS
            });
        }

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

        // Navigate to the URL
        console.log(`[PDF] Navigating to ${url}...`);
        const response = await page.goto(url, {
            waitUntil: ['networkidle2', 'domcontentloaded'],
            timeout: 60000
        });

        // Check for 401 or 403 (Vercel login wall)
        if (response && (response.status() === 401 || response.status() === 403)) {
            throw new Error(`Access Denied (Status ${response.status()}). This deployment might be protected by Vercel Authentication.`);
        }

        // Wait for React to finish rendering
        try {
            console.log('[PDF] Waiting for selector #pdf-ready...');
            await page.waitForSelector('#pdf-ready', { timeout: 15000 });
            // Small extra buffer
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            console.error(`[PDF] Timeout waiting for #pdf-ready selector. Proceeding anyway, but PDF might be incomplete.`);
        }

        // Generate PDF
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' },
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
        res.status(500).json({
            error: 'Failed to generate PDF',
            details: error.message
        });
    }
};

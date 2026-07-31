const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

// Cities to test (Downtown areas)
const CITIES = [
    { name: "Vaduz, Liechtenstein", code: "LIE", lon: 9.5215, lat: 47.1415 },
    { name: "Sao Paulo, Brazil", code: "BRA", lon: -46.6333, lat: -23.5505 },
    { name: "Marseille, France", code: "FRA", lon: 5.3698, lat: 43.2965 },
    { name: "Cairo, Egypt", code: "EGY", lon: 31.2357, lat: 30.0444 },
    { name: "Nairobi, Kenya", code: "KEN", lon: 36.8219, lat: -1.2921 },
    { name: "Mumbai, India", code: "IND", lon: 72.8777, lat: 19.0760 },
    { name: "Tokyo, Japan", code: "JPN", lon: 139.6503, lat: 35.6762 },
    { name: "Sydney, Australia", code: "AUS", lon: 151.2093, lat: -33.8688 },
    { name: "Cape Town, South Africa", code: "ZAF", lon: 18.4241, lat: -33.9249 },
    { name: "San Jose, Costa Rica", code: "CRI", lon: -84.0789, lat: 9.9281 }
];

const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }
    if (filePath.includes('?')) {
        filePath = filePath.split('?')[0];
    }
    const extname = path.extname(filePath);
    let contentType = 'text/html';
    switch (extname) {
        case '.js': contentType = 'text/javascript'; break;
        case '.css': contentType = 'text/css'; break;
        case '.json': contentType = 'application/json'; break;
        case '.png': contentType = 'image/png'; break;
        case '.jpg': contentType = 'image/jpg'; break;
        case '.parquet': contentType = 'application/octet-stream'; break;
    }
    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404);
            res.end('File not found');
        } else {
            res.writeHead(200, {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Range'
            });
            res.end(content, 'utf-8');
        }
    });
});

async function testSingleCity(city) {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        context.setDefaultTimeout(60000); // 60s timeout
        const page = await context.newPage({
            viewport: { width: 800, height: 600 }
        });

        // Intercept network requests to verify HTTP range request usage
        const requestsLog = [];
        page.on('request', request => {
            const url = request.url();
            if (url.includes('.parquet')) {
                requestsLog.push({
                    url,
                    method: request.method(),
                    range: request.headers()['range']
                });
            }
        });

        await page.goto(`http://localhost:${PORT}/index.html`);

        await page.waitForFunction(() => {
            const status = document.getElementById('status').innerText;
            return status === 'DuckDB ready' || status.includes('buildings');
        });

        // Wait for countries list to load
        await page.waitForFunction(() => {
            return window.COUNTRIES && window.COUNTRIES.length > 0;
        });

        // Wait for buildings source to be ready
        await page.waitForFunction(() => {
            return window.map && window.map.getSource('buildings') !== undefined;
        });

        // Pan and Zoom map to city
        await page.evaluate((c) => {
            window.map.setZoom(18);
            window.map.setCenter([c.lon, c.lat]);

            // Fire moveend repeatedly to ensure load
            window.testInterval = setInterval(() => {
                const status = document.getElementById('status').innerText;
                if (status === 'DuckDB ready' || status.includes('Zoom') || status.includes('Loading')) {
                    if (window.map.getSource('buildings')) {
                        window.map.fire('moveend');
                    }
                }
            }, 2000);
        }, city);

        // Wait for buildings to finish loading with a 45-second timeout
        let success = false;
        try {
            await page.waitForFunction(() => {
                const status = document.getElementById('status').innerText;
                return (/^\d+ buildings$/.test(status)) || /^Error/.test(status);
            }, { timeout: 45000 });
            success = true;
        } catch (e) {
            // Timeout
        }

        const featuresCount = await page.evaluate(() => {
            const source = window.map.getSource('buildings');
            return source ? source._data.features.length : 0;
        });

        const parquetRequests = requestsLog.filter(r => r.url.includes('.parquet'));
        const fullGetRequests = parquetRequests.filter(r => r.method === 'GET' && !r.range);
        const rangeGetRequests = parquetRequests.filter(r => r.method === 'GET' && r.range);
        const headRequests = parquetRequests.filter(r => r.method === 'HEAD');

        const isPassed = success && featuresCount > 0 && fullGetRequests.length === 0;

        await browser.close();
        return {
            city: city.name,
            code: city.code,
            features: featuresCount,
            rangeRequests: rangeGetRequests.length,
            fullGetRequests: fullGetRequests.length,
            headRequests: headRequests.length,
            passed: isPassed
        };
    } catch (error) {
        console.error(`Error testing ${city.name}:`, error);
        if (browser) await browser.close();
        return {
            city: city.name,
            code: city.code,
            features: 0,
            rangeRequests: 0,
            fullGetRequests: 0,
            headRequests: 0,
            passed: false,
            error: error.message
        };
    }
}

async function runTest() {
    const results = [];
    console.log("Testing 10 global cities sequentially in fresh browser instances...");
    for (const city of CITIES) {
        console.log(`\nTesting ${city.name} (${city.code})...`);
        const res = await testSingleCity(city);
        results.push(res);
        console.log(`Result for ${city.name}: ${res.passed ? 'PASSED ✅' : 'FAILED ❌'} (${res.features} buildings, Range GETs: ${res.rangeRequests}, Full GETs: ${res.fullGetRequests})`);
    }

    console.log(`\n==================================================`);
    console.log(`               10 CITIES TEST SUMMARY             `);
    console.log(`==================================================`);
    let allPassed = true;
    for (const res of results) {
        console.log(`${res.city} (${res.code}): ${res.features} buildings | Range GETs: ${res.rangeRequests} | Full GETs: ${res.fullGetRequests} | HEADs: ${res.headRequests} | ${res.passed ? 'PASSED ✅' : 'FAILED ❌'}${res.error ? ' Error: ' + res.error : ''}`);
        if (!res.passed) {
            allPassed = false;
        }
    }
    console.log(`==================================================`);
    return allPassed;
}

server.listen(PORT, async () => {
    const passed = await runTest();
    server.close();
    process.exit(passed ? 0 : 1);
});

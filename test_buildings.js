const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const getPixels = require('get-pixels');

const PORT = 8080;

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
            // Set CORS headers for DuckDB-WASM
            res.writeHead(200, {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            });
            res.end(content, 'utf-8');
        }
    });
});

async function runTest() {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        context.setDefaultTimeout(60000);
        const page = await context.newPage({
            viewport: { width: 800, height: 600 }
        });

        page.on('console', msg => console.log('PAGE LOG:', msg.text()));

        // We use VAT.parquet which we downloaded earlier. It has 10 buildings.
        // It's much smaller and tests logic perfectly without downloading 17GB BRA data in the headless browser.
        await page.route('**/countries.json', route => {
            console.log("Intercepting countries.json to use VAT data");
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    url_template: `http://localhost:${PORT}/test_data/{code}.parquet`,
                    default_country: "VAT",
                    countries: [
                        { code: "VAT", name: "Vatican City", bbox: [12.45, 41.9, 12.46, 41.91] }
                    ]
                })
            });
        });

        await page.goto(`http://localhost:${PORT}/index.html`);

        await page.waitForFunction(() => {
            const status = document.getElementById('status').innerText;
            return status === 'DuckDB ready' || status.includes('buildings');
        });

        await page.evaluate(() => {
            window.map.setZoom(20);
            window.map.setCenter([12.455, 41.905]); // VAT

            setInterval(() => {
                const status = document.getElementById('status').innerText;
                if (status === 'DuckDB ready' || status.includes('Zoom')) {
                    if (window.map.getSource('buildings')) {
                        window.map.fire('moveend');
                    }
                }
            }, 3000);
        });

        console.log("Waiting for VAT buildings to load...");
        await page.waitForFunction(() => {
            const status = document.getElementById('status').innerText;
            return (/^\d+ buildings$/.test(status)) || /^Error/.test(status);
        }, { timeout: 60000 });

        await page.evaluate(() => {
            const select = document.getElementById('basemap');
            select.value = 'blank';
            select.dispatchEvent(new Event('change'));
        });

        await page.waitForTimeout(5000);
        await page.screenshot({ path: 'screenshot.png' });
        await browser.close();

        return new Promise((resolve, reject) => {
            getPixels('screenshot.png', function(err, pixels) {
                if (err) {
                    console.error("Bad image path");
                    reject(err);
                    return;
                }

                let isBlank = true;
                const data = pixels.data;

                let nonWhitePixels = 0;
                let buildingColorPixels = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] < 250 || data[i+1] < 250 || data[i+2] < 250) {
                        nonWhitePixels++;
                    }
                    if (data[i] > 200 && data[i+1] > 100 && data[i+1] < 200 && data[i+2] < 150) {
                        buildingColorPixels++;
                    }
                }

                console.log(`Found ${nonWhitePixels} non-white pixels`);
                console.log(`Found ${buildingColorPixels} building color pixels`);

                if (nonWhitePixels < 2000 || buildingColorPixels < 50) {
                    console.error("TEST FAILED: Screenshot is mostly blank. No buildings were rendered.");
                    resolve(false);
                } else {
                    console.log("TEST PASSED: Buildings were rendered in the screenshot.");
                    resolve(true);
                }
            });
        });
    } catch (error) {
        console.error(error);
        if (browser) await browser.close();
        return false;
    }
}

server.listen(PORT, async () => {
    const passed = await runTest();
    server.close();
    process.exit(passed ? 0 : 1);
});

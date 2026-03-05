const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8081;

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

async function runTest() {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        context.setDefaultTimeout(60000); // 60s timeout
        const page = await context.newPage({
            viewport: { width: 800, height: 600 }
        });

        page.on('console', msg => console.log('PAGE LOG:', msg.text()));

        let parquetRequests = 0;
        let parquetRangeRequests = 0;
        let totalBytes = 0;

        page.on('request', request => {
            if (request.url().includes('.parquet')) {
                parquetRequests++;
                const headers = request.headers();
                if (headers['range']) {
                    parquetRangeRequests++;
                    console.log(`[Network] Parquet Range request: ${headers['range']}`);
                } else {
                    console.log(`[Network] Parquet Full request (no Range header): ${request.url()}`);
                }
            }
        });

        page.on('response', async response => {
            if (response.url().includes('.parquet')) {
                const headers = response.headers();
                const contentLength = headers['content-length'];
                if (contentLength) {
                    totalBytes += parseInt(contentLength, 10);
                }
            }
        });

        await page.goto(`http://localhost:${PORT}/index.html`);

        await page.waitForFunction(() => {
            const status = document.getElementById('status').innerText;
            return status === 'DuckDB ready' || status.includes('buildings');
        });

        console.log("DuckDB ready. Setting map to Sao Paulo...");

        // Set the map center to Sao Paulo at zoom 18
        await page.evaluate(() => {
            window.map.setZoom(18);
            window.map.setCenter([-46.6333, -23.5505]);

            setInterval(() => {
                const status = document.getElementById('status').innerText;
                if (status === 'DuckDB ready' || status.includes('Zoom')) {
                    if (window.map.getSource('buildings')) {
                        window.map.fire('moveend');
                    }
                }
            }, 3000);
        });

        console.log("Waiting up to 60s for remote BRA buildings to load...");

        let success = false;
        try {
            await page.waitForFunction(() => {
                const status = document.getElementById('status').innerText;
                return (/^\d+ buildings$/.test(status)) || /^Error/.test(status);
            }, { timeout: 50000 });
            success = true;
        } catch (e) {
            console.log("Timeout waiting for buildings to load. Evaluation finished.");
        }

        console.log(`\n--- Network Evaluation Summary ---`);
        console.log(`Total Parquet requests: ${parquetRequests}`);
        console.log(`Total Parquet range requests: ${parquetRangeRequests}`);
        console.log(`Total downloaded bytes (approx): ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

        if (!success) {
            console.log("Result: The query did NOT complete within the timeout, implying it's downloading too much data.");
        } else {
            console.log("Result: The query completed within the timeout.");

            // Check bounding box
            const checkResult = await page.evaluate(() => {
                const features = window.map.getSource('buildings')._data.features;
                const bounds = window.map.getBounds();
                const w = bounds.getWest();
                const e = bounds.getEast();
                const s = bounds.getSouth();
                const n = bounds.getNorth();

                let outOfBounds = 0;
                for (const f of features) {
                    if (f.geometry && f.geometry.coordinates) {
                        // A feature intersects if AT LEAST ONE of its coordinates is inside the bounding box
                        // or if the bounding box completely contains it.
                        // For a stricter check (to see if it's completely out of bounds), we check if ALL
                        // points are outside, and the bbox doesn't intersect the polygon.
                        // A simpler way to count "completely out of bounds" is if the bbox of the feature
                        // does not intersect the map bounds at all.
                        let f_w = 180, f_e = -180, f_s = 90, f_n = -90;
                        const checkPoly = (poly) => {
                            for (const ring of poly) {
                                for (const coord of ring) {
                                    if (coord[0] < f_w) f_w = coord[0];
                                    if (coord[0] > f_e) f_e = coord[0];
                                    if (coord[1] < f_s) f_s = coord[1];
                                    if (coord[1] > f_n) f_n = coord[1];
                                }
                            }
                        };
                        if (f.geometry.type === 'Polygon') {
                            checkPoly(f.geometry.coordinates);
                        } else if (f.geometry.type === 'MultiPolygon') {
                            for (const poly of f.geometry.coordinates) {
                                checkPoly(poly);
                            }
                        }
                        // Check if feature bbox intersects map bbox
                        const intersects = !(f_e < w || f_w > e || f_n < s || f_s > n);
                        if (!intersects) {
                            outOfBounds++;
                        }
                    }
                }
                return {
                    total: features.length,
                    outOfBounds,
                    w, e, s, n
                };
            });
            console.log(`Total features returned: ${checkResult.total}`);
            console.log(`Features completely out of bounds: ${checkResult.outOfBounds}`);
        }

        await browser.close();
    } catch (error) {
        console.error(error);
        if (browser) await browser.close();
    }
}

server.listen(PORT, async () => {
    await runTest();
    server.close();
    process.exit(0);
});

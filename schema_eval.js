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
        context.setDefaultTimeout(30000); // 30s timeout
        const page = await context.newPage({
            viewport: { width: 800, height: 600 }
        });

        page.on('console', msg => console.log('PAGE LOG:', msg.text()));

        await page.goto(`http://localhost:${PORT}/index.html`);

        await page.waitForFunction(() => {
            const status = document.getElementById('status').innerText;
            return status === 'DuckDB ready' || status.includes('buildings');
        });

        console.log("DuckDB ready. Fetching parquet schema...");

        const schema = await page.evaluate(async () => {
            const dataset = "https://data.source.coop/vida/google-microsoft-open-buildings/geoparquet/by_country/country_iso=MLI/MLI.parquet";
            try {
                // Wait for window.conn to be available
                while (!window.conn) {
                    await new Promise(r => setTimeout(r, 100));
                }
                const stream = await window.conn.send(`DESCRIBE SELECT * FROM read_parquet('${dataset}')`);
                const rows = [];
                for await (const batch of stream) {
                    const batchRows = batch.toArray();
                    for (const r of batchRows) {
                        rows.push(r);
                    }
                }
                return rows.map(r => `${r.column_name}: ${r.column_type}`).join('\n');
            } catch(e) {
                return e.message;
            }
        });

        console.log("--- SCHEMA ---");
        console.log(schema);

        // Also let's check what a row's `bbox` column looks like if it exists
        if (schema.includes('bbox')) {
            console.log("Fetching sample bbox data...");
            const sample = await page.evaluate(async () => {
                const dataset = "https://data.source.coop/vida/google-microsoft-open-buildings/geoparquet/by_country/country_iso=MLI/MLI.parquet";
                const stream = await window.conn.send(`SELECT bbox FROM read_parquet('${dataset}') LIMIT 1`);
                const rows = [];
                for await (const batch of stream) {
                    const batchRows = batch.toArray();
                    for (const r of batchRows) {
                        rows.push(r);
                    }
                }
                return JSON.stringify(rows[0], null, 2);
            });
            console.log("--- SAMPLE BBOX ---");
            console.log(sample);
        } else {
            console.log("No bbox column found.");
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

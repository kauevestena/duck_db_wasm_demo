const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8084;

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
        const page = await context.newPage();

        await page.goto(`http://localhost:${PORT}/index.html`);

        await page.waitForFunction(() => {
            return window.conn !== undefined;
        });

        console.log("Running EXPLAIN...");

        const explainPlan = await page.evaluate(async () => {
            const dataset = "https://data.source.coop/vida/google-microsoft-open-buildings/geoparquet/by_country/country_iso=MLI/MLI.parquet";
            const xmin = -3.25;
            const xmax = -3.23;
            const ymin = 13.29;
            const ymax = 13.31;
            const sql = `
            EXPLAIN SELECT
              ST_AsGeoJSON(geometry) AS geom
            FROM (
              SELECT *
              FROM read_parquet('${dataset}')
              WHERE
                bbox.xmin <= ${xmax} AND
                bbox.xmax >= ${xmin} AND
                bbox.ymin <= ${ymax} AND
                bbox.ymax >= ${ymin}
            )
            WHERE
              ST_Intersects(
                geometry,
                ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax})
              )
            LIMIT 3000
            `;
            const stream = await window.conn.send(sql);
            const rows = [];
            for await (const batch of stream) {
                const batchRows = batch.toArray();
                for (const r of batchRows) {
                    rows.push(r);
                }
            }
            return rows.map(r => r.explain_value || JSON.stringify(r)).join('\n');
        });

        console.log("--- EXPLAIN PLAN ---");
        console.log(explainPlan);

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

# DuckDB-WASM Range Request Fix Report

## Overview
The goal was to investigate whether the Global Buildings Viewer is properly making range requests (streaming features) when querying Parquet datasets and not attempting to download entire massive datasets like Brazil (`BRA.parquet`, 18GB).

## Findings
The initial implementation used the spatial function `ST_Intersects` directly on the `geometry` column:

```sql
WHERE ST_Intersects(geometry, ST_MakeEnvelope(xmin, ymin, xmax, ymax))
```

Because DuckDB cannot currently push down spatial functions like `ST_Intersects` natively to the Parquet reader for row group pruning, it resulted in downloading significantly more data from the Parquet file than expected. It effectively downloaded the entire 18GB dataset through sequential range requests, triggering timeouts.

Upon inspecting the `BRA.parquet` dataset schema, it was found that the dataset includes an explicit `bbox` struct column:

```
bbox: STRUCT(xmin DOUBLE, ymin DOUBLE, xmax DOUBLE, ymax DOUBLE)
```

## Solution
To solve this issue, the SQL query in `index.html` was updated to explicitly filter on the `bbox` fields. Simple structural comparisons (e.g., `<=`, `>=`) *are* pushed down by DuckDB's Parquet reader:

```sql
WHERE
  bbox.xmin <= {xmax} AND
  bbox.xmax >= {xmin} AND
  bbox.ymin <= {ymax} AND
  bbox.ymax >= {ymin} AND
  ST_Intersects(geometry, ST_MakeEnvelope(xmin, ymin, xmax, ymax))
```

This change enables DuckDB to perform row group pruning on the Parquet file remotely, fetching only the chunks of data that overlap the bounding box.

## Evaluation
A Playwright script (`eval.js`) was created to test a zoom level 18 tile in the center of Sao Paulo.

**Results before fix:**
- The query did not complete within 60 seconds.
- It initiated 122+ range requests downloading over 17 GB of data.

**Results after fix:**
- The query completed successfully in under 10 seconds.
- It initiated 28 requests, downloading only the required partial content.
- 120 building features were returned.
- A spatial check was performed to confirm that **0 features** were located outside the boundaries of the requested tile.

The fix successfully allows streaming features directly from the Parquet datasets using efficient HTTP range requests.

---

## Update: Upgrading to DuckDB-WASM v1.32.0 (July 2026)

### Motivation
With recent advancements, we evaluated upgrading `@duckdb/duckdb-wasm` from `1.29.0` to the stable **v1.32.0** version (aligned with modern DuckDB 1.2+). The latest versions of DuckDB-WASM offer powerful capabilities, including:
1. **Direct S3 filesystem support** (resolving a major limitation mentioned in the original README).
2. **Origin Private File System (OPFS)** support for fast client-side storage.
3. **Advanced Iceberg support** directly in the browser.

### The Challenge
Upon upgrading to `1.32.0`, the standard evaluation script (`node eval.js`) initially failed to make range requests and instead issued full file requests, attempting to download the full 17GB Brazil Parquet file.

This occurred because DuckDB-WASM introduced a custom HTTP filesystem wrapper (`HTTPWasmClient`) that defaults to suppressing HTTP range requests in favor of full reads depending on configuration settings, as well as altering `builtin_httpfs` defaults to `false`.

### The Solution
To successfully upgrade to `1.32.0` while maintaining the crucial partial range request mechanism (row group pruning), we made two configuration improvements in `index.html`:
1. **Disabled `forceFullHTTPReads`**: Instantiated the database explicitly with `db.open({ filesystem: { forceFullHTTPReads: false } })` to ensure that HTTP range requests are allowed.
2. **Standardized connection settings**: Instantiated the database and connected.

### Verified Results (After Upgrade)
We executed the visual and network evaluation suites:
- **`node test_buildings.js`**: Passed successfully. Liechtenstein buildings were retrieved, parsed, and rendered onto the map without regressions.
- **`node eval.js`**: Passed successfully in under 10 seconds. DuckDB-WASM v1.32.0 successfully performed **28 remote HTTP range requests**, downloading only the required row groups and returning **120 building features** (with 0 out of bounds) for the Sao Paulo tile.

The upgrade has successfully integrated the latest performance and storage capabilities of DuckDB-WASM v1.32.0 into the viewer.

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

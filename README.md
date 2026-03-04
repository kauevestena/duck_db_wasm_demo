# 🌍 Global Buildings Viewer (DuckDB-WASM)

A **fully serverless global building viewer** powered by:

* **DuckDB-WASM**
* **MapLibre GL**
* **GeoParquet**
* **Google + Microsoft Open Buildings dataset**

The application runs entirely in the browser and can be hosted as a **static site (e.g., GitHub Pages)**. No backend server is required.

---

# ✨ Features

* 🌎 **Global dataset**
* ⚡ **Serverless architecture**
* 📦 Uses **cloud-native GeoParquet**
* 🔎 **BBox queries executed in the browser**
* 🧠 Uses **DuckDB SQL engine in WebAssembly**
* 🚫 **No data downloaded until zoom ≥ 13**
* 🗂 Queries only the **relevant country partitions**

---

# 🏗 Architecture

```
Browser
   │
   ├── MapLibre GL (map rendering)
   │
   ├── DuckDB-WASM (SQL engine)
   │
   └── GeoParquet datasets
        ↓
  Google + Microsoft Open Buildings
```

Workflow:

1. User pans or zooms the map
2. When **zoom ≥ 13**, the map bounding box is detected
3. The viewer selects the **country dataset**
4. DuckDB runs a SQL query directly on the GeoParquet files
5. Returned geometries are rendered on the map

Only the required Parquet row groups are fetched thanks to **predicate pushdown and partial reads**.

---

# 📊 Dataset

This viewer uses the **Google + Microsoft Open Buildings dataset**, a global dataset containing roughly **2.5 billion building footprints**.

Dataset source:

https://source.coop/vida/google-microsoft-open-buildings

The data is distributed as **GeoParquet files partitioned by country**, which allows efficient querying from the browser.

Example partition:

```
country_iso=BRA/
country_iso=USA/
country_iso=IND/
```

---

# 🚀 Running the Viewer

## Option 1 — GitHub Pages (recommended)

1. Create a repository
2. Add the file:

```
index.html
```

3. Enable **GitHub Pages**
4. Open the site

Example:

```
https://username.github.io/repository-name
```

No build step is required.

---

## Option 2 — Local testing

You can run a simple local server:

```bash
python -m http.server
```

Then open:

```
http://localhost:8000
```

---

# 🔍 How Queries Work

When the map moves:

```sql
SELECT
  ST_AsGeoJSON(geometry)
FROM read_parquet(country_dataset)
WHERE
  bbox.xmin < xmax
  AND bbox.xmax > xmin
  AND bbox.ymin < ymax
  AND bbox.ymax > ymin
LIMIT 3000
```

This query:

1. Reads the **country GeoParquet partition**
2. Filters features using the **map bounding box**
3. Returns only a small subset of buildings.

---

# ⚠️ Current Limitations

* Country detection uses a **simple longitude heuristic**
* Large countries may still contain many buildings
* DuckDB-WASM currently lacks direct **S3 filesystem support**

Future improvements could include:

* Natural Earth country polygons
* quadkey-based partition loading
* vector tile generation

---

# 🛠 Technologies Used

* DuckDB-WASM
  https://duckdb.org/docs/api/wasm

* MapLibre GL JS
  https://maplibre.org

* GeoParquet
  https://geoparquet.org

* Google + Microsoft Open Buildings
  https://source.coop/vida/google-microsoft-open-buildings

---

# 💡 Why This Project Exists

This demo shows that **large geospatial datasets can be explored directly in the browser** using modern cloud-native formats.

Instead of a traditional stack:

```
PostGIS
→ GeoServer
→ OGC API
```

we can use:

```
GeoParquet
→ DuckDB-WASM
→ Browser
```

This enables **fully serverless geospatial applications**.

---

# 📜 License

This viewer code is released under the **MIT License**.

The building dataset is provided under the terms specified by the dataset authors.

# main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import geopandas as gpd
import pandas as pd
import numpy as np
import os
import re
import logging
import numbers
from typing import List, Dict, Optional, Any

logger = logging.getLogger("uvicorn.error")

app = FastAPI(title="Buildings 3D API")

# ----------------------------------------------------------------------
# CORS - adjust origins as needed for production
# ----------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # adjust / env-driven if needed
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------------------------------------------------
# Load ONLY buildings_3d
# ----------------------------------------------------------------------
DATA_PATH = "../data"
BUILDINGS_GDF: Optional[gpd.GeoDataFrame] = None


@app.on_event("startup")
async def load_buildings():
    """Load the buildings_3d.geojson into global BUILDINGS_GDF on startup."""
    global BUILDINGS_GDF
    file_path = os.path.join(DATA_PATH, "buildings_3d.geojson")
    if not os.path.exists(file_path):
        logger.error("buildings_3d.geojson not found at %s", file_path)
        raise RuntimeError(f"Missing buildings_3d.geojson at {file_path}")

    try:
        gdf = gpd.read_file(file_path)
    except Exception as exc:
        logger.exception("Failed to read buildings GeoJSON: %s", exc)
        raise RuntimeError("Could not read buildings_3d.geojson") from exc

    # ensure 'height' column exists and is numeric
    if "height" not in gdf.columns:
        logger.error("Column 'height' missing in buildings_3d.geojson")
        raise RuntimeError("Column 'height' missing in buildings_3d.geojson")

    # normalize height column to numeric (meters)
    gdf["height"] = pd.to_numeric(gdf["height"], errors="coerce")

    heights = gdf["height"].dropna()
    if heights.empty:
        logger.warning("Loaded buildings but 'height' column has no numeric values")
        min_h = max_h = 0.0
    else:
        min_h, max_h = heights.min(), heights.max()

    logger.info(
        "Loaded buildings_3d – %d rows, height range %.1f–%.1f m",
        len(gdf),
        float(min_h),
        float(max_h),
    )
    BUILDINGS_GDF = gdf


# ----------------------------------------------------------------------
# Pydantic models
# ----------------------------------------------------------------------
class QueryRequest(BaseModel):
    text: str
    point: Optional[List[float]] = None  # note: convention often [lon, lat] for maps


class GeoResponse(BaseModel):
    features: List[Dict]
    bounds: List[float]  # [minx, miny, maxx, maxy]
    insights: List[str]
    color_legend: Dict[str, str]  # {"low": "#hex", "high": "#hex"}


# ----------------------------------------------------------------------
# Height → colour (blue → red gradient)
# ----------------------------------------------------------------------
def height_to_color(height: float, low_h: float, high_h: float) -> str:
    """Return a hex colour for a height value inside [low_h, high_h]."""
    if pd.isna(height):
        return "#1f78b4"
    if high_h == low_h:
        return "#1f78b4"  # solid blue if all heights are equal
    ratio = (float(height) - float(low_h)) / (float(high_h) - float(low_h))
    ratio = max(0.0, min(1.0, ratio))
    r = int(255 * ratio)
    g = int(255 * (1 - ratio))
    b = 0
    return f"#{r:02x}{g:02x}{b:02x}"


# ----------------------------------------------------------------------
# Parse the natural-language query for height
# ----------------------------------------------------------------------
# This regex looks for words like "height", "taller", "above", "greater", etc.
# and captures an operator (symbol or textual) and the numeric value in meters.
HEIGHT_REGEX = re.compile(
    r"""
    (?P<anchor>\b(?:height|tall|taller|above|over|greater|less|below|under|at\s+least|at\s+most|exactly)\b)
    [^\d]{0,12}?
    (?P<op>>=|<=|>|<|=|==|greater\s+than|less\s+than|at\s+least|at\s+most|above|below|over|under|exactly)?
    \s*
    (?P<val>\d+(?:\.\d+)?)
    \s*(?:m|meters?)?
    """,
    re.IGNORECASE | re.VERBOSE,
)


def parse_height_filter(query: str) -> Optional[Dict[str, Any]]:
    """
    Parse a query string and return a dict: {"op": ">", "val": 30.0}
    or None if no height filter detected.
    Accepts symbols and common textual forms.
    """
    if not query:
        return None
    m = HEIGHT_REGEX.search(query)
    if not m:
        return None

    raw_op = (m.group("op") or "").strip().lower()
    val = float(m.group("val"))

    # Normalize textual operators to symbolic operators
    textual_map = {
        ">": ">",
        ">=": ">=",
        "<": "<",
        "<=": "<=",
        "=": "==",
        "==": "==",
        "greater than": ">",
        "greater": ">",
        "above": ">",
        "over": ">",
        "at least": ">=",
        "less than": "<",
        "less": "<",
        "below": "<",
        "under": "<",
        "at most": "<=",
        "exactly": "==",
    }

    # If operator not explicitly captured but the anchor word implies "taller", etc.
    if not raw_op:
        anchor = m.group("anchor") or ""
        anchor = anchor.lower()
        if anchor in ("tall", "taller", "height", "greater", "above", "over"):
            op = ">"
        elif anchor in ("less", "below", "under"):
            op = "<"
        else:
            op = "=="
    else:
        op = textual_map.get(raw_op, "==")

    return {"op": op, "val": val}


# ----------------------------------------------------------------------
# Apply filter + colour
# ----------------------------------------------------------------------
def apply_height_filter(
    gdf: gpd.GeoDataFrame,
    filt: Optional[Dict[str, Any]],
) -> gpd.GeoDataFrame:
    if filt is None:
        return gdf.copy()

    op, val = filt["op"], filt["val"]
    heights = pd.to_numeric(gdf["height"], errors="coerce")

    if op == ">":
        mask = heights > val
    elif op == ">=":
        mask = heights >= val
    elif op == "<":
        mask = heights < val
    elif op == "<=":
        mask = heights <= val
    else:  # "=="
        mask = heights == val

    filtered = gdf[mask].copy()
    logger.info("Height filter %s %s -> %d buildings (out of %d)", op, val, len(filtered), len(gdf))
    return filtered


def add_colour_column(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Add a `color` column based on numeric height range inside this GeoDataFrame."""
    gdf = gdf.copy()
    gdf["height_numeric"] = pd.to_numeric(gdf["height"], errors="coerce")
    heights = gdf["height_numeric"].dropna()
    if heights.empty:
        gdf["color"] = "#1f78b4"
        return gdf

    low, high = float(heights.min()), float(heights.max())
    gdf["color"] = gdf["height_numeric"].apply(
        lambda h: height_to_color(float(h), low, high) if pd.notnull(h) else "#1f78b4"
    )
    return gdf


# ----------------------------------------------------------------------
# Serialization helpers
# ----------------------------------------------------------------------
def normalize_property(v):
    """
    Convert pandas/numpy types into JSON-serializable Python types.
    """
    # missing / NaN
    if v is None:
        return None
    if pd.isna(v):
        return None

    # pandas / numpy numbers -> python numbers
    if isinstance(v, (np.integer, numbers.Integral)):
        return int(v)
    if isinstance(v, (np.floating, numbers.Real)):
        return float(v)

    # pandas Timestamp -> isoformat
    if isinstance(v, pd.Timestamp):
        return v.isoformat()

    # numpy bool_ etc.
    if isinstance(v, (np.bool_, bool)):
        return bool(v)

    # geometry objects or other complex types should not be in properties:
    # caller should have removed geometry; leave other serializable types as-is
    return v


# ----------------------------------------------------------------------
# Build response insights
# ----------------------------------------------------------------------
def build_insights(
    filtered: gpd.GeoDataFrame,
    filt: Optional[Dict[str, Any]],
    total: int,
) -> List[str]:
    insights = []
    if filt:
        op, val = filt["op"], filt["val"]
        op_text = {
            ">": "greater than",
            ">=": "at least",
            "<": "less than",
            "<=": "up to",
            "==": "exactly",
        }[op]
        insights.append(f"Showing buildings with height {op_text} {val} m.")
    else:
        insights.append("Showing all buildings.")

    insights.append(f"{len(filtered):,} of {total:,} buildings match the query.")

    if not filtered.empty and "height" in filtered.columns:
        h = pd.to_numeric(filtered["height"], errors="coerce").dropna()
        if not h.empty:
            insights.append(
                f"Height range in result: {h.min():.1f} m – {h.max():.1f} m (average {h.mean():.1f} m)"
            )
    return insights


# ----------------------------------------------------------------------
# /query endpoint
# ----------------------------------------------------------------------
@app.post("/query", response_model=GeoResponse)
async def query_geo(request: QueryRequest):
    if BUILDINGS_GDF is None:
        raise HTTPException(status_code=500, detail="Buildings dataset not loaded")

    # 1. Parse height filter
    height_filt = parse_height_filter(request.text)

    # 2. Apply filter
    filtered_gdf = apply_height_filter(BUILDINGS_GDF, height_filt)

    # 3. Add colour column (based on the *filtered* range)
    coloured_gdf = add_colour_column(filtered_gdf)

    # 4. Serialize features
    features = []
    for _, row in coloured_gdf.iterrows():
        # drop geometry and internal height_numeric column from properties
        props = row.drop(labels=["geometry", "height_numeric"], errors="ignore").to_dict()

        # normalize property types
        normalized_props = {k: normalize_property(v) for k, v in props.items()}

        # geometry
        geom = None
        try:
            geom = row.geometry.__geo_interface__ if row.geometry is not None else None
        except Exception:
            geom = None

        feat = {
            "type": "Feature",
            "properties": normalized_props,
            "geometry": geom,
        }
        features.append(feat)

    # 5. Bounds
    bounds = list(coloured_gdf.total_bounds) if not coloured_gdf.empty else [0, 0, 1, 1]

    # 6. Insights
    insights = build_insights(coloured_gdf, height_filt, len(BUILDINGS_GDF))

    # 7. Colour legend (low/high of the *filtered* set)
    if not coloured_gdf.empty:
        h = pd.to_numeric(coloured_gdf["height"], errors="coerce").dropna()
        low_h, high_h = float(h.min()), float(h.max())
        legend = {
            "low": height_to_color(low_h, low_h, high_h),
            "high": height_to_color(high_h, low_h, high_h),
        }
    else:
        legend = {"low": "#1f78b4", "high": "#1f78b4"}

    return GeoResponse(
        features=features,
        bounds=bounds,
        insights=insights,
        color_legend=legend,
    )


# ----------------------------------------------------------------------
# Simple health / examples
# ----------------------------------------------------------------------
@app.get("/datasets")
async def list_datasets():
    return {"datasets": ["buildings_3d"]}


@app.get("/examples")
async def example_queries():
    return {
        "examples": [
            "show all buildings",
            "taller than 30m",
            "height > 80",
            "height < 50",
            "height >= 100",
            "buildings with height exactly 45 m",
            "above 25 meters",
        ],
        "tip": "Any phrasing that mentions height (e.g. 'taller than 30m', 'height >= 50') should work.",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

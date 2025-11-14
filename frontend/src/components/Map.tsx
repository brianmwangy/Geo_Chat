"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import styles from "../styles/map.module.scss";

interface QueryResponse {
  features: any[];
  bounds: number[];
  insights?: string[];
  color_legend?: { low: string; high: string };
}

interface MapProps {
  queryData: QueryResponse | null;
  style: string;
  mapboxToken: string;
}

export default function Map({ queryData, style, mapboxToken }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  /* --------------------------------------------------------------- */
  /* 1. Initialise Map */
  /* --------------------------------------------------------------- */
  useEffect(() => {
    if (!mapContainer.current) return;

    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style,
      center: [36.8219, -1.2921], // Nairobi
      zoom: 14,
      pitch: 45,
      bearing: -17,
      antialias: true,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(new mapboxgl.FullscreenControl(), "top-right");

    map.once("load", () => {
      map.easeTo({ pitch: 55, bearing: -25, duration: 2000 });
      map.setFog({
        color: "rgb(230,230,255)",
        "high-color": "rgb(255,255,255)",
        "space-color": "rgb(11,11,25)",
        "horizon-blend": 0.1,
        "star-intensity": 0.1,
      });
      map.setLight({ anchor: "map", color: "white", intensity: 0.8 });
    });

    mapRef.current = map;

    return () => {
      popupRef.current?.remove();
      map.remove();
    };
  }, [mapboxToken]);

  /* --------------------------------------------------------------- */
  /* 2. Handle style changes safely */
  /* --------------------------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.once("styledata", () => {
      if (queryData?.features?.length) {
        updateBuildingsLayer(map, queryData);
      }
    });

    map.setStyle(style);
  }, [style]);

  /* --------------------------------------------------------------- */
  /* 3. New data → update layers */
  /* --------------------------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !queryData?.features?.length) return;

    if (map.isStyleLoaded()) {
      updateBuildingsLayer(map, queryData);
    } else {
      map.once("styledata", () => updateBuildingsLayer(map, queryData));
    }
  }, [queryData]);

  /* --------------------------------------------------------------- */
  /* 4. Helper: Add or update buildings */
  /* --------------------------------------------------------------- */
  function updateBuildingsLayer(map: mapboxgl.Map, data: QueryResponse) {
    const src = "buildings-3d-src";
    const lyr3d = "buildings-3d-layer";
    const lyrLabels = "building-labels";

    // safely remove dependent layers first
    [lyrLabels, lyr3d].forEach((id) => {
      if (map.getLayer(id)) {
        try {
          map.removeLayer(id);
        } catch (e) {
          console.warn(`Error removing layer ${id}:`, e);
        }
      }
    });

    if (map.getSource(src)) {
      try {
        map.removeSource(src);
      } catch (e) {
        console.warn("Error removing source:", e);
      }
    }

    // filter invalid features to avoid "get undefined"
    const validFeatures = data.features.filter(
      (f) => f?.properties && typeof f.properties === "object"
    );

    if (!validFeatures.length) {
      console.warn("No valid features found.");
      return;
    }

    // add new source
    map.addSource(src, {
      type: "geojson",
      data: { type: "FeatureCollection", features: validFeatures },
    });

    // add 3D layer
    map.addLayer({
      id: lyr3d,
      type: "fill-extrusion",
      source: src,
      paint: {
        "fill-extrusion-height": [
          "case",
          ["has", "height"],
          ["to-number", ["get", "height"]],
          0,
        ],
        "fill-extrusion-color": [
          "case",
          ["has", "color"],
          ["get", "color"],
          "#1f78b4",
        ],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.95,
      },
    });

    // add labels
    map.addLayer({
      id: lyrLabels,
      type: "symbol",
      source: src,
      layout: {
        "text-field": [
          "format",
          ["get", "name"],
          { "font-scale": 1.1 },
          "\n",
          {},
          ["concat", ["to-string", ["get", "height"]], " m"],
          { "font-scale": 0.9, "text-color": "#777" },
        ],
        "text-size": 12,
        "text-offset": [0, 1.2],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#222",
        "text-halo-color": "#fff",
        "text-halo-width": 1.2,
      },
    });

    // popups
    map.on("click", lyr3d, (e) => {
      const feature = e.features?.[0];
      if (!feature?.properties) return;

      const name = feature.properties.name || "Building";
      const height = feature.properties.height
        ? `${parseFloat(feature.properties.height).toFixed(1)} m`
        : "N/A";

      popupRef.current?.remove();
      popupRef.current = new mapboxgl.Popup({ closeButton: true, offset: 10 })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div style="font-family:system-ui,sans-serif;font-size:13px;">
             <strong>${name}</strong><br/>Height: ${height}
           </div>`
        )
        .addTo(map);
    });

    map.on("mouseenter", lyr3d, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", lyr3d, () => (map.getCanvas().style.cursor = ""));

    // fit to bounds
    if (data.bounds?.length === 4) {
      const [minx, miny, maxx, maxy] = data.bounds;
      if (minx < maxx && miny < maxy) {
        map.fitBounds(
          [
            [minx, miny],
            [maxx, maxy],
          ],
          { padding: 80, duration: 1800, pitch: 55, bearing: -25 }
        );
      }
    }

    updateLegend(data.color_legend);
  }

  /* --------------------------------------------------------------- */
  /* 5. Legend update */
  /* --------------------------------------------------------------- */
  function updateLegend(legend?: { low: string; high: string }) {
    if (!legendRef.current || !legend) return;
    legendRef.current.innerHTML = `
      <div style="background:linear-gradient(to right,${legend.low},${legend.high});
                  height:12px;border-radius:6px;margin:8px 0;"></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#555;">
        <span>Low</span><span>High</span>
      </div>
    `;
  }

  /* --------------------------------------------------------------- */
  /* 6. Render */
  /* --------------------------------------------------------------- */
  return (
    <div className={styles.mapWrapper}>
      <div ref={mapContainer} className={styles.mapContainer} />

      {queryData?.features?.length ? (
        <>
          <div
            ref={legendRef}
            style={{
              position: "absolute",
              bottom: 20,
              left: 20,
              background: "rgba(255,255,255,0.95)",
              padding: "12px",
              borderRadius: "8px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
              fontFamily: "system-ui,sans-serif",
              fontSize: "13px",
              maxWidth: "200px",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 20,
              left: 20,
              background: "rgba(0,0,0,0.7)",
              color: "#fff",
              padding: "6px 10px",
              borderRadius: "4px",
              fontSize: "12px",
              fontFamily: "monospace",
            }}
          >
            {queryData.features.length.toLocaleString()} buildings
          </div>
        </>
      ) : null}
    </div>
  );
}




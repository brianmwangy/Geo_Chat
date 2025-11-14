'use client';
import { useState } from "react";
import Chat from "../components/Chat";
import Map from "../components/Map";
import "../styles/global.scss";
import "../styles/basemap.scss";

interface QueryResponse {
  datasets: string[];
  bounds: number[];
  features: any[];
  insights: string[];
}

const MAPBOX_TOKEN =
  "pk.eyJ1IjoiYnJpYW5td2FuZ2kiLCJhIjoiY2x4OHRveWgxMjFqZTJxczlnbWptenU0aCJ9.ZDY491V-w8tn6nM2NBlkAw";

export default function Page() {
  const [queryData, setQueryData] = useState<QueryResponse | null>(null);
  const [basemap, setBasemap] = useState("streets-v12");

  const basemaps = [
    {
      id: "streets-v12",
      name: "Streets",
      thumbnail: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/36.8219,-1.2921,13/100x100?access_token=${MAPBOX_TOKEN}`,
    },
    {
      id: "dark-v11",
      name: "Dark",
      thumbnail: `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/36.8219,-1.2921,13/100x100?access_token=${MAPBOX_TOKEN}`,
    },
    {
      id: "satellite-v9",
      name: "Satellite",
      thumbnail: `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/36.8219,-1.2921,13/100x100?access_token=${MAPBOX_TOKEN}`,
    },
  ];

  return (
    <div className="relative w-full h-screen overflow-hidden">
      <Map
        queryData={queryData}
        style={`mapbox://styles/mapbox/${basemap}`}
        mapboxToken={MAPBOX_TOKEN}
      />
      <div className="logo-overlay">
        <img src="/images/logo.png" alt="Logo" />
      </div>
      <div className="basemapGallery">
        {basemaps.map((b) => (
          <div
            key={b.id}
            className={`item ${basemap === b.id ? "active" : ""}`}
            onClick={() => setBasemap(b.id)}
          >
            <img src={b.thumbnail} alt={b.name} />
            <span>{b.name}</span>
          </div>
        ))}
      </div>
      <Chat onQuery={(data) => setQueryData(data)} />
    </div>
  );
}
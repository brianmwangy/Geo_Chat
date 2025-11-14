// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.scss";

export const metadata: Metadata = {
  title: "GeoChat",
  description: "AI-powered geospatial chat app",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import "./globals.css";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rayong Crop Tracker",
  description: "Team progress for Sentinel-2 → SR → GenAI → Features → RF",
};

// Inline init script: set html.dark class before paint to avoid flash.
const themeInit = `
(function() {
  try {
    var stored = localStorage.getItem('rayong-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || (!stored && prefersDark);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

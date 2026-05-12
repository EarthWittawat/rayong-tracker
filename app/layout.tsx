import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rayong Crop Tracker",
  description: "Team progress for Sentinel-2 → SR → GenAI → Features → RF",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

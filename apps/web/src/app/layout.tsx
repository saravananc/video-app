import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FAV — Faceless AI Video",
  description: "Generate faceless videos from a topic: script, visuals, voiceover, captions, render."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LAST CANDLE",
  description: "A battle royale on Bitcoin. Every minute, half the players die.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

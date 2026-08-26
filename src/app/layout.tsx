import type { Metadata } from "next";
import { Russo_One, Chakra_Petch } from "next/font/google";
import "./globals.css";

/**
 * The esports pairing: Russo One for anything the player shouts about (the
 * clock, the multiplier, the verdict), Chakra Petch for everything else.
 *
 * Loaded through next/font so they are self-hosted with font-display: swap —
 * a webfont that arrives late would reflow the countdown mid-round.
 */
const display = Russo_One({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const body = Chakra_Petch({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LAST CANDLE",
  description: "A battle royale on Bitcoin. Every minute, half the players die.",
  icons: { icon: "/favicon-64.png", apple: "/icon.png" },
  openGraph: {
    title: "LAST CANDLE",
    description: "A battle royale on Bitcoin. Every minute, half the players die.",
    images: ["/logo-full.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}

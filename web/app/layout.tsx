import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nunito } from "next/font/google";
import "./globals.css";
import { PostHogSetup } from "@/components/PostHogSetup";

// A friendly, rounded, highly legible typeface -- approachable for residents.
const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// Absolute origin. Open Graph requires absolute image URLs -- Facebook fetches the page
// from its own servers, where a root-relative "/og.png" means nothing. `metadataBase`
// is what lets the relative paths below resolve correctly.
const SITE_URL = "https://pondviewforecast.vercel.app";

const TITLE = "Pondview Pool Forecaster";
const DESCRIPTION =
  "See when Pondview Pool is quiet or busy, hour by hour, predicted from the day's weather.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: TITLE,
    title: TITLE,
    description: DESCRIPTION,
    // Declaring the dimensions matters: without them the very first scrape often
    // renders without the image, because the crawler has not measured it yet.
    // scripts/make_og_image.py guarantees the file is exactly this size.
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "The Pondview Pool forecast page, showing hour-by-hour predicted arrivals.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={nunito.variable}>
      <body>
        <PostHogSetup />
        {children}
      </body>
    </html>
  );
}

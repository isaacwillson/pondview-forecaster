import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { PostHogSetup } from "@/components/PostHogSetup";

// A neutral, tightly-drawn UI sans. It replaced Nunito, whose rounded terminals read as
// friendly at the cost of reading as a toy -- the wrong signal for a page whose job is
// to show a model's output and be believed.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Reserved for figures, axis ticks and metric values -- anything the reader should
// treat as a measurement rather than prose. Its digits are monospaced by construction,
// so columns line up without needing a `tabular-nums` override.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  display: "swap",
});

// Absolute origin. Open Graph requires absolute image URLs -- Facebook fetches the page
// from its own servers, where a root-relative "/og.png" means nothing. `metadataBase`
// is what lets the relative paths below resolve correctly.
const SITE_URL = "https://pondviewforecast.vercel.app";

const TITLE = "Pondview Pool Forecaster";
// Serves both readers of a shared link: a resident wants to know when to go, and anyone
// looking at this as a piece of work wants to know there is a real model behind it.
const DESCRIPTION =
  "See when Pondview Pool is quiet or busy, hour by hour — predicted from the day's " +
  "weather by a model trained on a season of pool sign-in sheets.";

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
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <PostHogSetup />
        {children}
      </body>
    </html>
  );
}

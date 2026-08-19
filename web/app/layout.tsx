import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nunito } from "next/font/google";
import "./globals.css";

// A friendly, rounded, highly legible typeface -- approachable for residents.
const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pondview Pool Forecaster",
  description:
    "See when Pondview Pool is quiet or busy, hour by hour, predicted from the day's weather.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={nunito.variable}>
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "La Palme d’Or Gems | Bespoke Natural Stone Jewelry",
  description:
    "Bespoke rings, pendants, bracelets, and fine jewelry crafted with natural IGI-certified stones by La Palme d’Or, a jewelry house with over 40 years of heritage in Egypt.",
  applicationName: "La Palme d’Or Gems",
  keywords: [
    "La Palme d’Or",
    "La Palme d’Or Gems",
    "bespoke jewelry Egypt",
    "natural stone jewelry",
    "emerald jewelry",
    "ruby jewelry",
    "sapphire jewelry",
    "diamond jewelry",
    "IGI-certified stones",
  ],
  authors: [{ name: "La Palme d’Or Gems" }],
  creator: "La Palme d’Or Gems",
  publisher: "La Palme d’Or Gems",
  openGraph: {
    title: "La Palme d’Or Gems | Bespoke Natural Stone Jewelry",
    description:
      "Bespoke fine jewelry crafted with natural IGI-certified stones by La Palme d’Or, a jewelry house with over 40 years of heritage in Egypt.",
    siteName: "La Palme d’Or Gems",
    type: "website",
    locale: "en_US",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${cormorant.variable} h-full scroll-smooth antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}

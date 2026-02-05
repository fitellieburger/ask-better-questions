import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Playfair_Display } from "next/font/google";
import { Cormorant_Garamond } from "next/font/google";

import "./globals.css";


const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  style: ["italic"],
  weight: ["500"],
  variable: "--font-ask-serif",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-ask-serif",
  style: ["italic"],
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ask Better Questions",
  description: "Get Better Answers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      
      <body className={`${playfair.variable}`}>
  {children}
</body>

    </html>
  );
}

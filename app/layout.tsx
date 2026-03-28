import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Starling — Nemo Operations Center",
  description: "AI-powered crime analysis and operations platform powered by OpenAI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          rel="stylesheet"
          href="https://cesium.com/downloads/cesiumjs/releases/1.125/Build/Cesium/Widgets/widgets.css"
        />
      </head>
      <body className={`${geistMono.variable} font-mono antialiased bg-[#0a0a0f]`}>
        {children}
      </body>
    </html>
  );
}

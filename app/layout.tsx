import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Emlak Cafe Sanal Maket",
  description: "Kat planı ve renderlardan profesyonel 3B sanal maket üretim stüdyosu."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}

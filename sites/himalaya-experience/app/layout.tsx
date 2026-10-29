import type { Metadata } from "next";
import "./globals.css";
import "./theme.css";

export const metadata: Metadata = {
  title: "HIMALAYA — Explore the Soul of Himachal",
  description: "A cinematic journey through Dharamshala, McLeod Ganj, Kangra, and the Dhauladhar mountains.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NavLinks } from "@/components/nav-links";
import { SectionProvider } from "@/context/section-context";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Deep Research Agent",
  description: "AI-powered deep research agent that searches the web and synthesizes comprehensive answers",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <SectionProvider>
          <nav className="border-b px-4 py-2.5 flex items-center gap-4 text-sm">
            <span className="text-base font-bold tracking-tight text-foreground">AI Research</span>
            <span className="h-4 w-px bg-border flex-shrink-0" />
            <NavLinks />
          </nav>
          {children}
        </SectionProvider>
      </body>
    </html>
  );
}

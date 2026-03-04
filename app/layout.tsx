import type { Metadata } from "next";
import { DM_Serif_Display, Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import { NavLinks } from "@/components/nav-links";
import { SectionProvider } from "@/context/section-context";
import "./globals.css";

const dmSerifDisplay = DM_Serif_Display({
  variable: "--font-dm-serif",
  subsets: ["latin"],
  weight: "400",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Research Suite — AI Intelligence Platform",
  description: "AI-powered deep research agent and news intelligence hub",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${dmSerifDisplay.variable} ${plusJakartaSans.variable} ${geistMono.variable} antialiased min-h-screen`}
      >
        <SectionProvider>
          <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0"
                style={{ boxShadow: "0 0 14px oklch(0.80 0.165 58 / 0.45)" }}
              >
                <span className="text-primary-foreground text-[10px] font-bold tracking-widest">AI</span>
              </div>
              <span className="font-semibold text-sm tracking-tight">Research Suite</span>
              <span className="text-muted-foreground/50 text-xs hidden sm:block">·</span>
              <span className="text-muted-foreground text-xs hidden sm:block">Intelligence Platform</span>
            </div>
            <NavLinks />
          </nav>
          {children}
        </SectionProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { TerminalPanel } from "@/components/terminal-panel";
import { StatusBar } from "@/components/status-bar";
import { CompileProvider } from "@/lib/compile-context";
import { ThemeProvider } from "@/lib/theme-context";
import { TerminalProvider } from "@/lib/terminal-context";
import { OnboardingGate } from "@/lib/onboarding-gate";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NestBrain",
  description: "LLM-powered personal knowledge base",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-screen overflow-hidden flex bg-background text-foreground">
        <ThemeProvider>
          <CompileProvider>
            <TerminalProvider>
              <OnboardingGate>
                <Sidebar />
                <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                  <main className="flex-1 overflow-auto flex flex-col min-h-0">
                    {children}
                  </main>
                  <TerminalPanel />
                  <StatusBar />
                </div>
              </OnboardingGate>
            </TerminalProvider>
          </CompileProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

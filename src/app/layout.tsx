import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { StoreProvider } from "@/context/StoreContext";
import { AuthProvider } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WhatsAppButton from "@/components/WhatsAppButton";
import BottomNav from "@/components/BottomNav";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AngoStart — Infoprodutos, Produtos e Serviços em Angola",
  description:
    "A tua plataforma angolana de confiança: infoprodutos, produtos físicos, serviços ao domicílio e serviços remotos. Preços em Kwanzas, entrega em Luanda e atendimento pelo WhatsApp.",
  keywords: [
    "AngoStart",
    "Angola",
    "Luanda",
    "infoprodutos",
    "produtos físicos",
    "serviços ao domicílio",
    "serviços remotos",
    "Kwanza",
  ],
  authors: [{ name: "AngoStart" }],
  openGraph: {
    title: "AngoStart — Tudo o que o teu negócio precisa",
    description:
      "Infoprodutos, produtos físicos e serviços em Angola. Preços em Kwanzas e atendimento pelo WhatsApp.",
    siteName: "AngoStart",
    type: "website",
    locale: "pt_AO",
  },
};

export const viewport: Viewport = {
  themeColor: "#0F172A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-AO" suppressHydrationWarning>
      <body
        className={`${poppins.variable} flex min-h-screen flex-col antialiased bg-background text-foreground pb-[68px] md:pb-0`}
      >
        <AuthProvider>
          <StoreProvider>
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
            <WhatsAppButton />
            {/* Barra de navegação mobile (Fase 6, ponto 4) */}
            <BottomNav />
            {/* PWA (Fase 6, ponto 10) */}
            <ServiceWorkerRegister />
          </StoreProvider>
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}

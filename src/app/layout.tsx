import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { StoreProvider } from "@/context/StoreContext";
import { AuthProvider } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WhatsAppButton from "@/components/WhatsAppButton";
import SupportChatWidget from "@/components/SupportChatWidget";
import BottomNav from "@/components/BottomNav";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import RefCapture from "@/components/RefCapture";
import BackToTop from "@/components/BackToTop";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "GOMBUONE — Infoprodutos, Produtos, Serviços e Campanhas em Angola",
  description:
    "A tua plataforma angolana de confiança: marketplace de infoprodutos, produtos físicos e serviços, agora com motor de campanhas e oportunidades. Preços em Kwanzas, entrega em Luanda e atendimento pelo WhatsApp.",
  keywords: [
    "GOMBUONE",
    "Angola",
    "Luanda",
    "infoprodutos",
    "produtos físicos",
    "serviços ao domicílio",
    "serviços remotos",
    "campanhas",
    "oportunidades",
    "Kwanza",
  ],
  authors: [{ name: "GOMBUONE" }],
  openGraph: {
    title: "GOMBUONE — Tudo o que o teu negócio precisa",
    description:
      "Marketplace, campanhas e oportunidades em Angola. Preços em Kwanzas e atendimento pelo WhatsApp.",
    siteName: "GOMBUONE",
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

/** Anti-FOUC: aplica o tema guardado ANTES da primeira pintura.
    Tema claro é o padrão — só adiciona .dark se o utilizador escolheu. */
const themeInitScript = `
try {
  if (localStorage.getItem('angostart-theme') === 'dark') {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-AO" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${poppins.variable} flex min-h-screen flex-col overflow-x-hidden antialiased bg-background text-foreground pb-[calc(88px+env(safe-area-inset-bottom,0px))] md:pb-0`}
      >
        <AuthProvider>
          <StoreProvider>
            <RefCapture />
            <Navbar />
            {/* Fase 19b: overflow-x-hidden impede scroll lateral em 375–414px */}
            <main className="flex-1 overflow-x-hidden">{children}</main>
            <Footer />
            {/* Fase 16 — botão «Voltar ao topo» (fixo no canto, todas as páginas) */}
            <BackToTop />
            <WhatsAppButton />
            {/* Fase 14: assistente de suporte IA (canto inferior esquerdo) */}
            <SupportChatWidget />
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

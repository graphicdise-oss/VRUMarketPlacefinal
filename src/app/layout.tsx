import type { Metadata } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/components/cart/CartProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { AuthProvider } from "@/lib/auth-context";
import { SocketProvider } from "@/lib/socket-context";
import { FavoriteProvider } from "@/lib/favorite-context";
import { BadgeProvider } from "@/lib/badge-context";

const notoSansThai = Noto_Sans_Thai({
  variable: "--font-noto-sans-thai",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "VRU Marketplace - แหล่งรวมสินค้าชุมชนออนไลน์",
  description: "ศูนย์รวมสินค้าจากชุมชน และนวัตกรรมจากมหาวิทยาลัยราชภัฏวไลยอลงกรณ์ ส่งตรงถึงมือคุณอย่างมั่นใจ",
  icons: {
    icon: [
      { url: "/icon.png", type: "image/png", sizes: "256x256" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    shortcut: "/icon.png",
    apple: "/icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={notoSansThai.variable}>
      <head>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      </head>
      <body className="text-vru-dark font-sans pb-16 md:pb-0 antialiased">
        <AuthProvider>
          <SocketProvider>
            <BadgeProvider>
              <FavoriteProvider>
                <CartProvider>
                  <ToastProvider>
                    {children}
                  </ToastProvider>
                </CartProvider>
              </FavoriteProvider>
            </BadgeProvider>
          </SocketProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
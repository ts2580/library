import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TopProgressBar } from "@/components/ui/top-progress";
import "@/app/globals.css";
import "@/app/volume-layout.css";

export const metadata: Metadata = {
  title: { default: "Bookshelf", template: "%s · Bookshelf" },
  description: "개인 책장과 중고 재고 관리",
  icons: {
    icon: { url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ko"><body>{children}<TopProgressBar/></body></html>;
}

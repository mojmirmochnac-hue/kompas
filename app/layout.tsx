import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kompas · Osobný plánovač",
  description: "Plánovanie podľa hodnôt, rolí a najdôležitejších priorít.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sk">
      <body className="antialiased">{children}</body>
    </html>
  );
}

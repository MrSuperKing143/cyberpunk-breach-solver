import type { Metadata } from "next";
import "@/styles/globals.scss";

export const dynamic = "error";

export const metadata: Metadata = {
  title: "Cyberpunk 2077 Breach Protocol Solver",
  description:
    "Static-export Cyberpunk 2077 breach analyzer and solver with client-side OpenCV.js extraction.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

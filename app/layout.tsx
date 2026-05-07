import type { Metadata } from "next";
import "@/styles/globals.scss";

export const dynamic = "error";

export const metadata: Metadata = {
  title: "Cyberpunk 2077 Breach Protocol Solver",
  description:
    "Static-export Cyberpunk 2077 breach analyzer and solver with client-side OpenCV.js extraction.",
};

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const fontFaceCSS = `
@font-face {
  font-family: "Rajdhani";
  src: url("${base}/fonts/subset-Rajdhani-Bold.woff2") format("woff2"),
       url("${base}/fonts/subset-Rajdhani-Bold.woff") format("woff"),
       url("${base}/fonts/subset-Rajdhani-Bold.ttf") format("truetype");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Rajdhani";
  src: url("${base}/fonts/subset-Rajdhani-Medium.woff2") format("woff2"),
       url("${base}/fonts/subset-Rajdhani-Medium.woff") format("woff"),
       url("${base}/fonts/subset-Rajdhani-Medium.ttf") format("truetype");
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Rajdhani";
  src: url("${base}/fonts/subset-Rajdhani-Regular.woff2") format("woff2"),
       url("${base}/fonts/subset-Rajdhani-Regular.woff") format("woff"),
       url("${base}/fonts/subset-Rajdhani-Regular.ttf") format("truetype");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <style dangerouslySetInnerHTML={{ __html: fontFaceCSS }} />
      <body>{children}</body>
    </html>
  );
}

import "./globals.css";

export const metadata = {
  title: "Voice Calendar",
  appleWebApp: { capable: true, title: "Voice Cal" },
};
export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

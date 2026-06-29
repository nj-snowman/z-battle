import type { Metadata, Viewport } from 'next';
import { Anton, Saira_Condensed, Saira, Bangers } from 'next/font/google';
import Script from 'next/script';
import './globals.css';

const anton = Anton({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-anton',
  display: 'swap',
});

const bangers = Bangers({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-bangers',
  display: 'swap',
});

const sairaCondensed = Saira_Condensed({
  weight: ['400', '600', '700'],
  subsets: ['latin'],
  variable: '--font-saira-condensed',
  display: 'swap',
});

const saira = Saira({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-saira',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'Z-Battle',
  description: 'Dragon Ball Z Card Game',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Z-Battle',
  },
  icons: {
    apple: '/icon-192.png',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${anton.variable} ${sairaCondensed.variable} ${saira.variable} ${bangers.variable}`}>
      <body>
        {children}
        <Script id="sw-reg" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js');
          }
        `}</Script>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import { Geist_Mono } from 'next/font/google';
import './globals.css';

const siteUrl = new URL(
  process.env.NEXT_PUBLIC_SITE_URL ??
    'https://andy-japan-atlas.jzhoubc.chatgpt.site',
);

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: 'Japan Atlas — Andy’s personal field guide',
  description:
    'A private map of saved food, events, and architecture in Japan, connected to a personal assistant.',
  openGraph: {
    title: 'Japan Atlas',
    description: 'Your personal field guide to food, events & architecture.',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Japan Atlas',
    description: 'Your personal field guide to food, events & architecture.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import { Geist_Mono } from 'next/font/google';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
  : undefined;

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: 'Japan Atlas — Your personal field guide',
  description:
    'A personal collection of restaurants, visits, photos and videos, with public browsing and Owner-controlled agents.',
  openGraph: {
    title: 'Japan Atlas',
    description: 'Your personal field guide to food, events & architecture.',
    images: siteUrl
      ? [{ url: '/og.png', width: 1200, height: 630 }]
      : undefined,
    type: 'website',
  },
  twitter: {
    card: siteUrl ? 'summary_large_image' : 'summary',
    title: 'Japan Atlas',
    description: 'Your personal field guide to food, events & architecture.',
    images: siteUrl ? ['/og.png'] : undefined,
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

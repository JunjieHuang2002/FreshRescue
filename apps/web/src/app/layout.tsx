import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'FreshRescue',
  description: 'Track every batch in your fridge, get warned before food expires, and cook the recipes that use it first.',
};

// `cover` lets the page run under a phone's rounded corners and home bar; globals.css keeps the top bar and
// the tab bar clear of them with the safe-area insets. The theme colour is the page's own background.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f2f6f0',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

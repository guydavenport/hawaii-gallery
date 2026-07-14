import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Hawaii Gallery',
  description: 'A private gallery for photos and videos from a Hawaii trip.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

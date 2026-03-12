import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SuperClaw Pure',
  description: 'Personal AI assistant that works out of the box',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

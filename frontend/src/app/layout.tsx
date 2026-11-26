import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: 'ReachInbox — Email Scheduler',
  description: 'Schedule and manage your cold email campaigns',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // <html lang="en">
    //   <body>
    //     {children}
    //     <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
    //   </body>
    // </html>
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{ duration: 4000 }}
        />
      </body>
    </html>
  );
}

'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '../store/authStore';
import { Loader2 } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import MobileNav from '../components/MobileNav';
import { ToastContainer } from '../components/ui/Toast';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isInitialized, initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  const isPublicPage = pathname === '/login' || pathname === '/register';

  useEffect(() => {
    if (isInitialized && !isAuthenticated && !isPublicPage) {
      router.push('/login');
    }
  }, [isInitialized, isAuthenticated, isPublicPage, router]);

  if (!isInitialized) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg-dark text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isPublicPage) {
    return <>{children}</>;
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg-dark text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-bg-dark text-foreground overflow-hidden md:flex-row">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8 pb-24 md:pb-8 no-scrollbar">
          {children}
        </main>
      </div>

      <ToastContainer />
      <MobileNav />
    </div>
  );
}

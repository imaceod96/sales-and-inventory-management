import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopHeader } from './TopHeader';
import { AdminPinModal } from '../../modules/core/presentation/components/AdminPinModal';

export interface MainLayoutProps {
  readonly children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  return (
    <div className="min-h-dvh w-full overflow-x-hidden bg-[#F8F9FA] text-slate-900">
      <AdminPinModal />
      <Sidebar
        isMobileOpen={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      <div className="flex min-h-dvh min-w-0 flex-col lg:pl-64">
        <TopHeader onOpenMobileMenu={() => setIsMobileMenuOpen(true)} />

        <main className="flex-1 min-w-0 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          <div className="mx-auto w-full min-w-0 max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}


import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import LoadingShell from '@/components/shared/LoadingShell';

export default function AppLayout() {
  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-6 md:p-8">
          <Suspense fallback={<LoadingShell fullscreen={false} />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

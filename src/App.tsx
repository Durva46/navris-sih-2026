import { TopBar } from '@/components/layout/TopBar';
import { SystemPanel } from '@/components/system/SystemPanel';
import { NavigationProvider, useNavigationCommands, useNavigationUi } from '@/nav/NavigationContext';
import { LiveNavigation } from '@/pages/LiveNavigation';
import { Route, Routes } from 'react-router-dom';
import { Suspense, lazy } from 'react';

/**
 * Analytics is code-split on purpose. Recharts is the single heaviest
 * dependency in the app and it exists for a view most visitors will never
 * open, so it must not sit in the initial bundle that decides whether the demo
 * starts instantly on unfamiliar venue hardware.
 */
const AnalyticsPage = lazy(() => import('@/pages/Analytics'));

function AnalyticsFallback() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="border border-hairline bg-surface px-6 py-4 text-center">
        <p className="label-micro">Loading analytics</p>
        <div className="mx-auto mt-3 h-px w-32 overflow-hidden bg-hairline">
          <div className="h-full w-1/3 animate-sweep bg-ai" />
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const { systemPanelOpen } = useNavigationUi();
  const cmd = useNavigationCommands();

  return (
    // `h-full` on desktop pins the cockpit to the viewport. `min-h-full` below
    // `lg` lets the stacked layout grow past it and scroll the document, which
    // is the only way the side rail and drawer stay reachable on a phone.
    <div className="flex min-h-full flex-col lg:h-full lg:min-h-0">
      <TopBar />
      {/* Clipping is correct on desktop and harmful on mobile, so it is scoped
          to the breakpoint where the layout actually fits. */}
      <main className="flex min-h-0 flex-1 flex-col lg:overflow-hidden">
        <Suspense fallback={<AnalyticsFallback />}>
          <Routes>
            <Route path="/" element={<LiveNavigation />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="*" element={<LiveNavigation />} />
          </Routes>
        </Suspense>
      </main>
      <SystemPanel open={systemPanelOpen} onClose={() => cmd.setSystemPanelOpen(false)} />
    </div>
  );
}

export function App() {
  return (
    <NavigationProvider>
      <Shell />
    </NavigationProvider>
  );
}

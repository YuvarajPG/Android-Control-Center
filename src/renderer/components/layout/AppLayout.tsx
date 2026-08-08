import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { NavigationDrawer } from './NavigationDrawer';
import { Header } from './Header';
import { StatusBar } from './StatusBar';
import { ToastContainer } from '../feedback/ToastContainer';
import { SetupWizardModal } from '../../features/setup/SetupWizardModal';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useAppStore } from '../../store/useAppStore';
import { ipcService } from '../../services/ipcService';

export const AppLayout: React.FC = () => {
  const { settings, loadSettings } = useSettingsStore();
  const { initDiscovery } = useDeviceStore();
  const { addToast } = useAppStore();

  const [isFirstRunWizardOpen, setIsFirstRunWizardOpen] = useState<boolean>(false);

  const { devices } = useDeviceStore();
  const [trustedCount, setTrustedCount] = useState<number | null>(null);

  // Mount global keyboard navigation shortcuts (Ctrl+1..8, Ctrl+R)
  useKeyboardShortcuts();

  useEffect(() => {
    loadSettings();
    initDiscovery();

    ipcService.invoke<any[]>('device:list-trusted')
      .then((list) => setTrustedCount(Array.isArray(list) ? list.length : 0))
      .catch(() => setTrustedCount(0));

    // Listen to native backend desktop notifications pushed into toast overlay
    const unsubscribe = ipcService.on('app:toast-notification', (payload: unknown) => {
      if (payload && typeof payload === 'object' && 'title' in payload) {
        const notification = payload as { title: string; body?: string };
        addToast('info', `${notification.title}: ${notification.body || ''}`);
      }
    });

    ipcService.logger.info('Application shell initialized with Full Automation background engine', 'AppLayout');
    return () => unsubscribe();
  }, [loadSettings, initDiscovery, addToast]);

  // First-Run Wizard condition:
  // Show ONLY IF hasCompletedFirstRun is false AND no trusted devices AND no connected Android devices
  useEffect(() => {
    console.log(`[SetupWizard Audit] Startup onboardingCompleted=${settings.hasCompletedFirstRun}`);

    if (settings.hasCompletedFirstRun) {
      setIsFirstRunWizardOpen(false);
      return;
    }

    if (trustedCount === null) return;

    const hasOnlineDevice = devices.some((d) => d.status === 'online');
    const hasTrustedDevices = trustedCount > 0;

    if (!hasOnlineDevice && !hasTrustedDevices && !settings.hasCompletedFirstRun) {
      setIsFirstRunWizardOpen(true);
    } else {
      setIsFirstRunWizardOpen(false);
    }
  }, [settings.hasCompletedFirstRun, trustedCount, devices]);

  return (
    <ErrorBoundary>
      <div className="grid h-dvh w-full grid-rows-[var(--app-titlebar-height)_minmax(0,1fr)] overflow-hidden bg-m3-surface-0 text-m3-on-surface select-none">
        {/*
          Electron's hidden title-bar overlay draws above web content. This real
          layout row reserves that exact area for every route, instead of using
          padding on a full-height flex container.
        */}
        <div className="drag-region bg-m3-surface-0" aria-hidden="true" />

        <div className="flex min-h-0 min-w-0">
          {/* Fixed side navigation */}
          <NavigationDrawer />

          {/* Fixed toolbar + independently scrolling route content */}
          <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
            <Header />

            <main className="min-h-0 overflow-y-auto overflow-x-hidden bg-m3-surface-0/60 px-4 py-5 sm:px-6 sm:py-6">
              <Outlet />
            </main>

            <StatusBar />
          </div>
        </div>

        {/* Global Toast Overlay */}
        <ToastContainer />

        {/* First Run Automatic Setup Wizard */}
        <SetupWizardModal
          isOpen={isFirstRunWizardOpen}
          onClose={() => setIsFirstRunWizardOpen(false)}
        />
      </div>
    </ErrorBoundary>
  );
};

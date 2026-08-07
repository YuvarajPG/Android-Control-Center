import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeviceStore } from '../store/useDeviceStore';
import { useAppStore } from '../store/useAppStore';

/**
 * Global Keyboard Shortcut Hook:
 * Ctrl+1: Dashboard
 * Ctrl+2: Devices
 * Ctrl+3: File Explorer
 * Ctrl+4: App Manager
 * Ctrl+5: Screen Mirroring
 * Ctrl+6: Device Control
 * Ctrl+7: Developer Tools
 * Ctrl+8: Settings
 * Ctrl+R: Refresh ADB Bus
 */
export const useKeyboardShortcuts = () => {
  const navigate = useNavigate();
  const { refreshDevices } = useDeviceStore();
  const { addToast } = useAppStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not trigger if user is typing inside input or textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case '1':
            e.preventDefault();
            navigate('/dashboard');
            addToast('info', 'Shortcut: Navigated to Dashboard');
            break;
          case '2':
            e.preventDefault();
            navigate('/devices');
            addToast('info', 'Shortcut: Navigated to Devices');
            break;
          case '3':
            e.preventDefault();
            navigate('/file-manager');
            addToast('info', 'Shortcut: Navigated to File Explorer');
            break;
          case '4':
            e.preventDefault();
            navigate('/apps');
            addToast('info', 'Shortcut: Navigated to App Manager');
            break;
          case '5':
            e.preventDefault();
            navigate('/screen');
            addToast('info', 'Shortcut: Navigated to Screen Mirroring');
            break;
          case '6':
            e.preventDefault();
            navigate('/device-control');
            addToast('info', 'Shortcut: Navigated to Hardware Control');
            break;
          case '7':
            e.preventDefault();
            navigate('/developer');
            addToast('info', 'Shortcut: Navigated to Developer Tools');
            break;
          case '8':
            e.preventDefault();
            navigate('/settings');
            addToast('info', 'Shortcut: Navigated to Settings');
            break;
          case 'r':
          case 'R':
            e.preventDefault();
            addToast('info', 'Shortcut: Refreshing ADB Bus...');
            refreshDevices();
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, refreshDevices, addToast]);
};

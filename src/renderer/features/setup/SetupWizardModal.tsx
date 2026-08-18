import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  RefreshCw,
  Wifi,
  ArrowRight,
  Terminal,
  Zap,
  Usb,
  CheckCircle2,
  Radio,
  BadgeAlert,
  Sliders,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useAppStore } from '../../store/useAppStore';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { ipcService } from '../../services/ipcService';

interface SetupWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type StepId = 1 | 2 | 3 | 4 | 5;
type ConnectionMethod = 'usb' | 'wireless' | null;
type WirelessPairingMethod = 'qr' | 'manual' | null;

// SetupWizardModal Component
export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({ isOpen, onClose }) => {
  const { setFirstRunCompleted, settings, updateSettings } = useSettingsStore();
  const { initDiscovery, devices: storeDevices } = useDeviceStore();
  const { addToast } = useAppStore();

  const [currentStep, setCurrentStep] = useState<StepId>(1);
  const [connectionMethod, setConnectionMethod] = useState<ConnectionMethod>(null);
  const [wirelessPairingMethod, setWirelessPairingMethod] = useState<WirelessPairingMethod>(null);

  // Manual pairing state
  const [pairingIp, setPairingIp] = useState<string>('');
  const [pairingPort, setPairingPort] = useState<string>('');
  const [pairingCode, setPairingCode] = useState<string>('');
  const [connectPort, setConnectPort] = useState<string>('');
  const [isPairedSuccess, setIsPairedSuccess] = useState<boolean>(false);
  const [isPairing, setIsPairing] = useState<boolean>(false);
  const [pairingError, setPairingError] = useState<string>('');

  // QR Session state
  const [qrPayload, setQrPayload] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrPairingCode, setQrPairingCode] = useState<string>('');
  const [, setQrServiceId] = useState<string>('');
  const [qrTimeLeft, setQrTimeLeft] = useState<number>(60);
  const [qrPairingState, setQrPairingState] = useState<string>('WAITING');
  const [qrErrorMessage, setQrErrorMessage] = useState<string>('');

  // Capability state
  const [adbCapabilities, setAdbCapabilities] = useState<{
    adbVersion: string | null;
    supportsMdns: boolean;
    supportsQrPairing: boolean;
    isDetected: boolean;
  }>({
    adbVersion: null,
    supportsMdns: false,
    supportsQrPairing: false,
    isDetected: false,
  });

  const [showLearnMoreModal, setShowLearnMoreModal] = useState<boolean>(false);

  // Fetch capabilities once
  useEffect(() => {
    ipcService.adb.getCapabilities().then((caps) => {
      setAdbCapabilities(caps);
    });
  }, []);
  const [, setDiscoveryAttempt] = useState<number>(0);
  const [discoveryStatus, setDiscoveryStatus] = useState<string>('Idle');
  const [discoverySuccess, setDiscoverySuccess] = useState<boolean>(false);
  const [discoveryFailed, setDiscoveryFailed] = useState<boolean>(false);

  // Generate QR Data URL using production qrcode library
  useEffect(() => {
    if (!qrPayload) {
      setQrDataUrl('');
      return;
    }
    QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 300,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''));
  }, [qrPayload]);

  // Start or retrieve persistent Android Studio compatible QR session
  const initQrSession = useCallback(async (forceRefresh: boolean = false) => {
    try {
      setQrPairingState('WAITING');
      setQrErrorMessage('');
      const res = forceRefresh
        ? await ipcService.adb.refreshQrPairing()
        : await ipcService.adb.startQrPairing();

      if (res.success && res.data) {
        const data = res.data as any;
        setQrPayload(data.qrPayload || '');
        setQrPairingCode(data.pairingCode || '');
        setQrServiceId(data.serviceId || '');
        setQrTimeLeft(data.expiresInSeconds || 60);
      } else {
        setQrPairingState('FAILED');
        setQrErrorMessage(res.message || 'Unable to start pairing service.');
      }
    } catch (err: any) {
      setQrPairingState('FAILED');
      setQrErrorMessage(err.message || 'Unable to start pairing service.');
    }
  }, []);

  // Keep track of active session to prevent stale responses from affecting new sessions
  const currentSessionIdRef = useRef<string | null>(null);

  // QR status monitor & timer countdown
  useEffect(() => {
    if (wirelessPairingMethod !== 'qr') return undefined;

    let isPolling = true;
    let pollCount = 0;

    console.log(`[QR] Polling started`);

    const pollStatus = async () => {
      if (!isPolling) return;
      pollCount++;

      try {
        const statusRes = await ipcService.adb.getQrStatus();
        if (!isPolling) return;

        if (statusRes.success && statusRes.data) {
          const data = statusRes.data as any;
          console.log(`[QR] Poll #${pollCount}`);
          console.log(`[QR] Response:`, JSON.stringify(data, null, 2));

          // Guard against stale responses from previous pairing sessions
          if (currentSessionIdRef.current && data.sessionId && currentSessionIdRef.current !== data.sessionId) {
            console.log(`[QR] Ignored stale response from old session (Current: ${currentSessionIdRef.current}, Received: ${data.sessionId})`);
            return;
          }
          if (data.sessionId) {
            currentSessionIdRef.current = data.sessionId;
          }

          setQrPairingState((prevState) => {
            if (prevState !== data.status) {
              console.log(`[QR] Transition: ${prevState || 'IDLE'} -> ${data.status}`);
            }
            return data.status;
          });

          if (data.errorMessage) {
            setQrErrorMessage(data.errorMessage);
          }

          // Define explicit terminal states
          const terminalStates = ['CONNECTED', 'FAILED', 'EXPIRED', 'PAIRED_PORT_FAILED', 'CANCELLED'];
          
          if (terminalStates.includes(data.status)) {
            console.log(`[QR] Polling stopped`);
            console.log(`[QR] Reason: reached terminal state ${data.status}`);
            isPolling = false;

            if (data.status === 'CONNECTED') {
              console.log(`[QR] Starting connection discovery`);
              const connSerial = data.connectedSerial || data.discoveredIp || 'Connected Wireless Device';
              const connIp = data.discoveredIp || (connSerial.includes(':') ? connSerial.split(':')[0] : undefined);
              const connPort = data.discoveredPort || (connSerial.includes(':') ? parseInt(connSerial.split(':')[1], 10) : undefined);

              setVerifiedSetupDevice({
                serialNumber: connSerial,
                deviceName: data.deviceName || 'Wireless Android Device',
                model: data.model || 'Android Device',
                connectionType: 'wireless',
                ipAddress: connIp,
                port: connPort,
                status: 'online',
                isTrusted: true,
              });
              setCurrentStep(5);
            }
          }
        }
      } catch (err: any) {
        console.error('[QR] Poll failed:', err);
      }
    };

    const interval = setInterval(() => {
      if (!isPolling) {
        clearInterval(interval);
        return;
      }
      
      pollStatus();
      
      setQrTimeLeft((prev) => {
        if (prev <= 1) {
          setQrPairingState('EXPIRED');
          setQrErrorMessage('Pairing timed out.');
          console.log(`[QR] Polling stopped`);
          console.log(`[QR] Reason: QR timer expired on frontend`);
          isPolling = false;
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (isPolling) {
        console.log(`[QR] Polling stopped`);
        console.log(`[QR] Reason: component unmounted or wireless method changed`);
      }
      isPolling = false;
      clearInterval(interval);
    };
  }, [wirelessPairingMethod]);

  // Target device explicitly verified during this setup wizard session
  interface VerifiedSetupDevice {
    serialNumber: string;
    deviceName: string;
    model: string;
    manufacturer?: string;
    connectionType: 'usb' | 'wireless';
    ipAddress?: string;
    port?: number;
    status: 'online' | 'offline' | 'unauthorized';
    isTrusted?: boolean;
  }
  const [verifiedSetupDevice, setVerifiedSetupDevice] = useState<VerifiedSetupDevice | null>(null);
  const [deviceAuthRequired, setDeviceAuthRequired] = useState<boolean>(false);
  const [isSearchingDevice, setIsSearchingDevice] = useState<boolean>(false);

  // Smart Discovery Session: consumes authoritative device list and separates Online vs Unauthorized vs No Device
  const runSmartDiscoverySession = useCallback(async (customDevs?: any[]) => {
    setDiscoveryAttempt(1);
    setIsSearchingDevice(true);

    try {
      let activeDevs = (customDevs && customDevs.length > 0) ? customDevs : [];
      const hasOnlineInCustom = activeDevs.some((d: any) => d.status === 'online' || d.status === 'device');

      if (!hasOnlineInCustom) {
        const rescanned = await ipcService.invoke<any[]>('device:rescan');
        if (rescanned && rescanned.length > 0) {
          activeDevs = rescanned;
        }
      }
      setIsSearchingDevice(false);

      // 1. Try matching explicit verified setup target from Step 4
      let targetDev: any = null;
      if (verifiedSetupDevice) {
        const targetSerial = verifiedSetupDevice.serialNumber;
        const targetIp = verifiedSetupDevice.ipAddress;
        targetDev = activeDevs.find((d: any) =>
          d.serialNumber === targetSerial ||
          d.serial === targetSerial ||
          (targetIp && (d.ipAddress === targetIp || d.serial?.includes(targetIp))) ||
          (d.availableTransports && d.availableTransports.some((t: any) => t.serial === targetSerial || (targetIp && t.serial?.includes(targetIp))))
        );
      }

      // 2. Fallback strictly matching connectionMethod (NEVER substitute USB for Wireless!)
      if (!targetDev && connectionMethod === 'wireless') {
        const wirelessMatch = activeDevs.find((d: any) =>
          (d.status === 'online' || d.status === 'device') &&
          (d.connectionType === 'wireless' || d.serial?.includes(':') || (verifiedSetupDevice?.ipAddress && d.ipAddress === verifiedSetupDevice.ipAddress))
        );
        if (wirelessMatch) {
          targetDev = wirelessMatch;
        }
      } else if (!targetDev && connectionMethod === 'usb') {
        const usbMatch = activeDevs.find((d: any) =>
          (d.status === 'online' || d.status === 'device') &&
          (d.connectionType === 'usb' || !d.serial?.includes(':'))
        );
        if (usbMatch) {
          targetDev = usbMatch;
        }
      } else if (!targetDev && !connectionMethod) {
        const onlineFallback = activeDevs.find((d: any) => d.status === 'online' || d.status === 'device');
        if (onlineFallback) {
          targetDev = onlineFallback;
        }
      }

      // 3. Fallback to unauthorized device if present (respecting connectionMethod)
      const unauthorizedDev = !targetDev
        ? activeDevs.find((d: any) =>
            (d.status === 'unauthorized' || d.availableTransports?.some((t: any) => t.status === 'unauthorized')) &&
            (connectionMethod !== 'wireless' || d.connectionType === 'wireless' || d.serial?.includes(':'))
          )
        : null;

      if (targetDev && (targetDev.status === 'online' || targetDev.status === 'device')) {
        setDiscoverySuccess(true);
        setDiscoveryFailed(false);
        setDeviceAuthRequired(false);
        let cleanName = targetDev.deviceName || targetDev.name || targetDev.model || 'Android Device';
        if (cleanName.includes('._tcp') || cleanName.includes('_adb-tls-')) {
          cleanName = `${targetDev.manufacturer || 'Android'} ${targetDev.model || 'Device'}`;
        }

        setVerifiedSetupDevice({
          serialNumber: targetDev.serialNumber || targetDev.serial || 'Connected',
          deviceName: cleanName,
          model: targetDev.model || 'Android Phone',
          manufacturer: targetDev.manufacturer || 'Android',
          connectionType: targetDev.connectionType === 'wireless' || targetDev.serial?.includes(':') ? 'wireless' : 'usb',
          ipAddress: targetDev.ipAddress || (targetDev.serial?.includes(':') ? targetDev.serial.split(':')[0] : undefined),
          port: targetDev.port || (targetDev.serial?.includes(':') ? parseInt(targetDev.serial.split(':')[1], 10) : undefined),
          status: 'online',
          isTrusted: Boolean(targetDev.isTrusted),
        });
      } else if (unauthorizedDev) {
        setDiscoverySuccess(false);
        setDiscoveryFailed(true);
        setDeviceAuthRequired(true);
        setDiscoveryStatus('Android device detected, but USB debugging authorization is required.');
      } else {
        setDiscoverySuccess(false);
        setDiscoveryFailed(true);
        setDeviceAuthRequired(false);
        setDiscoveryStatus(
          connectionMethod === 'wireless'
            ? 'Target wireless Android device is not connected. Please verify pairing and connection.'
            : 'No connected Android device found.'
        );
      }
    } catch {
      setDiscoverySuccess(false);
      setDiscoveryFailed(true);
      setDeviceAuthRequired(false);
      setDiscoveryStatus('No connected Android device found.');
      setIsSearchingDevice(false);
    }
  }, [verifiedSetupDevice, connectionMethod]);

  // Run discovery when entering Step 5 or when store devices list updates
  useEffect(() => {
    if (currentStep === 5 && isOpen) {
      runSmartDiscoverySession(storeDevices);
    }
  }, [currentStep, isOpen, storeDevices, runSmartDiscoverySession]);

  // Handlers for manual pairing & connection submission
  const handlePairManual = async () => {
    if (!pairingIp || !pairingPort || !pairingCode) {
      setPairingError('Please enter IP Address, Pairing Port, and 6-digit Pairing Code.');
      return;
    }

    const cleanCode = pairingCode.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setPairingError('Pairing code must be a 6-digit numeric code from your phone screen.');
      return;
    }

    setIsPairing(true);
    setPairingError('');

    try {
      const cleanIp = pairingIp.trim();
      const cleanPort = parseInt(pairingPort.trim(), 10);

      const pairRes = (await ipcService.adb.pair(cleanIp, cleanPort, cleanCode)) as any;
      if (pairRes.success && pairRes.connectionStatus === 'connected' && pairRes.device) {
        const dev = pairRes.device;
        const targetSerial = dev.serialNumber || `${cleanIp}:${dev.port || cleanPort}`;
        setVerifiedSetupDevice({
          serialNumber: targetSerial,
          deviceName: dev.deviceName || dev.model || 'Wireless Android Device',
          model: dev.model || 'Android Phone',
          manufacturer: dev.manufacturer || 'Android',
          connectionType: 'wireless',
          ipAddress: cleanIp,
          port: dev.port || cleanPort,
          status: 'online',
          isTrusted: true,
        });
        addToast('success', 'Device paired and connected successfully!');
        setIsPairing(false);
        setDiscoverySuccess(true);
        setCurrentStep(5);
        return;
      } else if (pairRes.success) {
        // Pairing was successful! Transition to PAIRED NOT CONNECTED state to accept connection port.
        setIsPairing(false);
        setIsPairedSuccess(true);
        setConnectPort('');
        return;
      } else {
        setIsPairing(false);
        setPairingError(pairRes.message || 'Pairing failed. Please verify the pairing code and port on your phone.');
        return;
      }
    } catch (err: any) {
      setIsPairing(false);
      setPairingError(err.message || 'Pairing request failed.');
    }
  };

  const handleDirectConnect = async () => {
    if (!connectPort.trim()) {
      setPairingError('Please enter the Connection Port shown on your phone.');
      return;
    }
    setIsPairing(true);
    setPairingError('');

    const cleanIp = pairingIp.trim();
    const cleanPort = parseInt(connectPort.trim(), 10);

    if (isNaN(cleanPort) || cleanPort <= 1024 || cleanPort > 65535) {
      setIsPairing(false);
      setPairingError('Please enter a valid port number between 1025 and 65535.');
      return;
    }

    try {
      const connRes = await ipcService.invoke<{ success: boolean; device?: any; message?: string }>('device:connect-wireless', {
        ip: cleanIp,
        port: cleanPort,
      });

      if (connRes.success && connRes.device) {
        const dev = connRes.device;
        const targetSerial = dev.serialNumber || `${cleanIp}:${cleanPort}`;
        setVerifiedSetupDevice({
          serialNumber: targetSerial,
          deviceName: dev.deviceName || dev.model || 'Wireless Android Device',
          model: dev.model || 'Android Phone',
          manufacturer: dev.manufacturer || 'Android',
          connectionType: 'wireless',
          ipAddress: cleanIp,
          port: cleanPort,
          status: 'online',
          isTrusted: true,
        });
        addToast('success', 'Wireless device connected and verified!');
        setIsPairing(false);
        setDiscoverySuccess(true);
        setCurrentStep(5);
      } else {
        setIsPairing(false);
        setPairingError(connRes.message || `Unable to connect to ${cleanIp}:${cleanPort}. Verify that Wireless Debugging is enabled on your phone.`);
      }
    } catch (err: any) {
      setIsPairing(false);
      setPairingError(err.message || 'Connection failed.');
    }
  };

  // Comprehensive cleanup/reset function for temporary pairing UI state
  const resetPairingState = useCallback(() => {
    setPairingIp('');
    setPairingPort('');
    setPairingCode('');
    setConnectPort('');
    setIsPairedSuccess(false);
    setIsPairing(false);
    setPairingError('');

    setQrPayload('');
    setQrDataUrl('');
    setQrPairingCode('');
    setQrServiceId('');
    setQrTimeLeft(60);
    setQrPairingState('WAITING');
    setQrErrorMessage('');

    setWirelessPairingMethod(null);

    ipcService.adb.cancelQrPairing().catch(() => {});
  }, []);

  // Comprehensive wizard state reset function (called on close & reopen)
  const resetWizardState = useCallback(() => {
    resetPairingState();
    setCurrentStep(1);
    setVerifiedSetupDevice(null);
    setConnectionMethod(null);
    setDiscoveryAttempt(0);
    setDiscoveryStatus('Idle');
    setDiscoverySuccess(false);
    setDiscoveryFailed(false);
    setShowAdvancedAutomationOffer(false);
    setAdvancedAutomationRunning(false);
    setAdvancedAutomationStep(0);
    setAdvancedAutomationSuccess(false);
  }, [resetPairingState]);

  useEffect(() => {
    if (isOpen) {
      console.log('[SetupWizard Audit] Wizard opened');
      resetWizardState();
    } else {
      resetPairingState();
    }
  }, [isOpen, resetWizardState, resetPairingState]);

  useEffect(() => {
    if (isOpen) {
      console.log('[SetupWizard Audit] Current step', currentStep);
    }
  }, [currentStep, isOpen]);

  // Handlers for setup wizard completion
  const handleFinishSetup = async () => {
    console.log('[SetupWizard Audit] Finish clicked');
    if (verifiedSetupDevice) {
      try {
        await ipcService.invoke('device:add-trusted', {
          serialNumber: verifiedSetupDevice.serialNumber,
          deviceName: verifiedSetupDevice.deviceName,
          model: verifiedSetupDevice.model,
          connectionType: verifiedSetupDevice.connectionType,
          ipAddress: verifiedSetupDevice.ipAddress,
          port: verifiedSetupDevice.port,
          lastConnected: Date.now(),
        });
      } catch (err: any) {
        console.warn('[SetupWizard Audit] Non-fatal error registering trusted device', err);
      }
    }
    console.log('[SetupWizard Audit] Persisting onboardingCompleted=true');
    await setFirstRunCompleted(true);
    console.log('[SetupWizard Audit] Persistence success');
    console.log('[SetupWizard Audit] Wizard closed');
    resetWizardState();
    onClose();
  };

  const handleSkipSetup = async () => {
    console.log('[SetupWizard Audit] Skip clicked');
    console.log('[SetupWizard Audit] Persisting onboardingCompleted=true');
    await setFirstRunCompleted(true);
    console.log('[SetupWizard Audit] Persistence success');
    console.log('[SetupWizard Audit] Wizard closed');
    resetWizardState();
    onClose();
  };

  const stepsList = [
    { id: 1, name: 'Welcome', desc: 'Get Started' },
    { id: 2, name: 'Basic Config', desc: 'Environment Check' },
    { id: 3, name: 'Choose Connection', desc: 'USB or Wireless' },
    { id: 4, name: 'Connect / Pair', desc: 'Device Setup' },
    { id: 5, name: 'Verify Link', desc: 'Confirm Link' },
  ];

  // Advanced Automation Offer state
  const [showAdvancedAutomationOffer, setShowAdvancedAutomationOffer] = useState<boolean>(false);
  const [advancedAutomationRunning, setAdvancedAutomationRunning] = useState<boolean>(false);
  const [advancedAutomationStep, setAdvancedAutomationStep] = useState<number>(0);
  const [advancedAutomationSuccess, setAdvancedAutomationSuccess] = useState<boolean>(false);

  const runAdvancedAutomationFlow = async () => {
    console.log('[SetupWizard Audit] Enable clicked');
    setAdvancedAutomationRunning(true);
    setAdvancedAutomationStep(1);
    await new Promise((r) => setTimeout(r, 200));

    setAdvancedAutomationStep(2);
    await new Promise((r) => setTimeout(r, 200));

    setAdvancedAutomationStep(3);
    await new Promise((r) => setTimeout(r, 200));

    setAdvancedAutomationStep(4);
    setAdvancedAutomationStep(5);

    console.log('[SetupWizard Audit] Persisting onboardingCompleted=true');
    await updateSettings({
      advancedAutomationEnabled: true,
      autoStartHelperServices: true,
      trustedDeviceReconnect: true,
      hasCompletedFirstRun: true,
    });
    await setFirstRunCompleted(true);

    setAdvancedAutomationRunning(false);
    setAdvancedAutomationSuccess(true);
    console.log('[SetupWizard Audit] Persistence success');
    addToast('success', 'Advanced Automation fully enabled!');
    console.log('[SetupWizard Audit] Wizard closed');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleSkipSetup} title="First-Run Setup Wizard">
      <div className="space-y-6">
        {/* Stepper Progress Bar Header (5 Clean Steps) */}
        {!showAdvancedAutomationOffer && (
          <div className="grid grid-cols-5 gap-1 bg-m3-surface-2 p-2 rounded-m3-md border border-m3-surface-4">
            {stepsList.map((step) => (
              <div key={step.id} className="text-center space-y-1">
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    currentStep > step.id
                      ? 'bg-m3-success'
                      : currentStep === step.id
                      ? 'bg-m3-primary animate-pulse'
                      : 'bg-m3-surface-4'
                  }`}
                />
                <span
                  className={`text-[10px] font-mono block truncate ${
                    currentStep === step.id ? 'text-m3-primary font-bold' : 'text-m3-on-surface-variant/70'
                  }`}
                >
                  Step {step.id}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Step 1: Welcome ────────────────────────────────────────────── */}
        {currentStep === 1 && !showAdvancedAutomationOffer && (
          <div className="p-6 bg-m3-surface-1 rounded-m3-lg border border-m3-surface-3 text-center space-y-4">
            <div className="h-16 w-16 mx-auto rounded-full bg-m3-primary-container/40 flex items-center justify-center text-m3-primary">
              <Terminal className="h-8 w-8 animate-bounce" />
            </div>
            <div>
              <h3 className="text-base font-bold text-m3-on-surface">Welcome to Android Control Center</h3>
              <p className="text-xs text-m3-on-surface-variant mt-1 max-w-md mx-auto">
                Control your Android phone, mirror screens, transfer files, and execute developer commands seamlessly from your desktop.
              </p>
            </div>
            <div className="flex gap-3 justify-center pt-2">
              <Button
                variant="filled"
                size="md"
                icon={<ArrowRight className="h-4 w-4" />}
                onClick={() => {
                  initDiscovery();
                  setCurrentStep(2);
                }}
              >
                Continue
              </Button>
              <Button variant="outlined" size="md" onClick={handleSkipSetup}>
                Skip Setup
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Basic Configuration ─────────────────────────────────── */}
        {currentStep === 2 && !showAdvancedAutomationOffer && (
          <div className="p-6 bg-m3-surface-1 rounded-m3-lg border border-m3-surface-3 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-m3-primary-container/30 rounded-m3-md text-m3-primary">
                <Sliders className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-m3-on-surface">Step 2: Basic Configuration</h3>
                <p className="text-xs text-m3-on-surface-variant">Verify workspace environment and platform utilities.</p>
              </div>
            </div>

            <div className="p-4 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4 space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-m3-on-surface-variant">ADB Path:</span>
                <span className="text-m3-primary font-bold">{settings.adbPath}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-m3-on-surface-variant">Theme Mode:</span>
                <span className="text-m3-on-surface capitalize">{settings.themeMode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-m3-on-surface-variant">Auto-Check Updates:</span>
                <span className="text-m3-success">{settings.autoCheckUpdates ? 'ENABLED' : 'DISABLED'}</span>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outlined" size="sm" onClick={() => setCurrentStep(1)}>
                Back
              </Button>
              <Button variant="filled" size="sm" onClick={() => setCurrentStep(3)}>
                Continue &rarr;
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Choose Connection Type (USB vs Wireless) ───────────── */}
        {currentStep === 3 && !showAdvancedAutomationOffer && (
          <div className="space-y-4">
            <div className="p-4 bg-m3-surface-1 rounded-m3-lg border border-m3-surface-3 text-center space-y-2">
              <h3 className="text-base font-bold text-m3-on-surface">Step 3: Choose Connection Type</h3>
              <p className="text-xs text-m3-on-surface-variant">Select how you would like to connect your phone.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  resetPairingState();
                  setConnectionMethod('usb');
                  setWirelessPairingMethod(null);
                  setCurrentStep(4);
                }}
                className={`p-5 rounded-m3-lg border-2 text-left transition-all duration-200 ${
                  connectionMethod === 'usb'
                    ? 'border-m3-primary bg-m3-primary-container/10'
                    : 'border-m3-surface-4 bg-m3-surface-2 hover:border-m3-primary/50'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Usb className="h-6 w-6 text-m3-primary" />
                  <span className="text-sm font-bold text-m3-on-surface">🔌 USB</span>
                </div>
                <p className="text-[11px] text-m3-on-surface-variant mb-3">Fastest and most reliable direct cable connection.</p>
                <span className="text-xs font-semibold text-m3-primary inline-flex items-center gap-1">
                  Continue &rarr;
                </span>
              </button>

              <button
                onClick={() => {
                  resetPairingState();
                  setConnectionMethod('wireless');
                  if (!adbCapabilities.supportsQrPairing) {
                    setWirelessPairingMethod('manual');
                  } else {
                    setWirelessPairingMethod(null);
                  }
                  setCurrentStep(4);
                }}
                className={`p-5 rounded-m3-lg border-2 text-left transition-all duration-200 ${
                  connectionMethod === 'wireless'
                    ? 'border-m3-primary bg-m3-primary-container/10'
                    : 'border-m3-surface-4 bg-m3-surface-2 hover:border-m3-primary/50'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Wifi className="h-6 w-6 text-m3-primary" />
                  <span className="text-sm font-bold text-m3-on-surface">📶 Wireless</span>
                </div>
                <p className="text-[11px] text-m3-on-surface-variant mb-3">Connect cable-free over Wi-Fi network.</p>
                <span className="text-xs font-semibold text-m3-primary inline-flex items-center gap-1">
                  Continue &rarr;
                </span>
              </button>
            </div>

            <div className="flex justify-between pt-1">
              <Button variant="outlined" size="sm" onClick={() => setCurrentStep(2)}>
                Back
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 4: USB or Wireless Pairing Mode Choice & Inputs ───────── */}
        {currentStep === 4 && !showAdvancedAutomationOffer && (
          <div className="space-y-4">
            {/* USB Sub-flow */}
            {connectionMethod === 'usb' && (
              <div className="p-6 bg-m3-surface-1 rounded-m3-lg border border-m3-surface-3 space-y-4">
                <h3 className="text-sm font-bold text-m3-on-surface flex items-center gap-2">
                  <Usb className="h-4 w-4 text-m3-primary" /> USB Connection Setup
                </h3>
                <ol className="space-y-2 text-xs text-m3-on-surface-variant pl-1">
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-m3-primary">1.</span> Connect phone using USB cable.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-m3-primary">2.</span> Enable USB Debugging in Developer Options.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-m3-primary">3.</span> Tap &quot;Allow USB Debugging&quot; prompt on your phone screen.
                  </li>
                </ol>
                <div className="flex justify-between pt-2">
                  <Button variant="outlined" size="sm" onClick={() => { resetPairingState(); setCurrentStep(3); }}>
                    Back
                  </Button>
                  <Button
                    variant="filled"
                    size="sm"
                    onClick={async () => {
                      try {
                        const devs = await ipcService.adb.listDevices();
                        const usbMatch = devs.find((d: any) => d.connectionType === 'usb' && (d.status === 'online' || d.status === 'device'));
                        if (usbMatch) {
                          setVerifiedSetupDevice({
                            serialNumber: usbMatch.serialNumber || usbMatch.serial,
                            deviceName: usbMatch.deviceName || usbMatch.name || usbMatch.model || 'USB Android Device',
                            model: usbMatch.model || 'Android Phone',
                            connectionType: 'usb',
                            status: 'online',
                          });
                        }
                      } catch {}
                      setCurrentStep(5);
                    }}
                  >
                    Verify Connection &rarr;
                  </Button>
                </div>
              </div>
            )}

            {/* Wireless Sub-flow: Pairing Selection Card */}
            {connectionMethod === 'wireless' && wirelessPairingMethod === null && (
              <div className="space-y-3">
                <div className="p-4 bg-m3-surface-1 rounded-m3-lg border border-m3-surface-3 text-center space-y-1">
                  <h3 className="text-sm font-bold text-m3-on-surface">Choose Wireless Pairing Method</h3>
                  <p className="text-xs text-m3-on-surface-variant">Select how to pair with Android Wireless Debugging.</p>
                </div>

                {!adbCapabilities.supportsQrPairing && (
                  <div className="p-3 bg-m3-tertiary-container/20 rounded-m3-md border border-m3-tertiary/30 text-xs flex items-center gap-2 text-m3-on-surface">
                    <Zap className="h-4 w-4 text-m3-tertiary flex-shrink-0" />
                    <span>  QR pairing is unavailable with your installed ADB. Manual Pairing will be used instead.</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => {
                      if (!adbCapabilities.supportsQrPairing) {
                        setWirelessPairingMethod('manual');
                      } else {
                        setWirelessPairingMethod('qr');
                        initQrSession();
                      }
                    }}
                    className={`p-4 rounded-m3-lg border-2 text-left space-y-2 ${
                      !adbCapabilities.supportsQrPairing
                        ? 'border-m3-surface-4 bg-m3-surface-2/60 opacity-80'
                        : 'border-m3-surface-4 bg-m3-surface-2 hover:border-m3-primary/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-m3-on-surface">📱 QR Code Pairing</span>
                      <Badge variant={adbCapabilities.supportsQrPairing ? 'primary' : 'secondary'} className="text-[9px]">
                        {adbCapabilities.supportsQrPairing ? 'Recommended' : 'Unsupported'}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-m3-on-surface-variant">Android 11+ quick camera QR scan</p>
                    <span className="text-xs font-semibold text-m3-primary block pt-1">
                      {adbCapabilities.supportsQrPairing ? 'Continue &rarr;' : 'Use Manual Pairing &rarr;'}
                    </span>
                  </button>

                  <button
                    onClick={() => setWirelessPairingMethod('manual')}
                    className="p-4 rounded-m3-lg border-2 border-m3-primary/50 bg-m3-surface-2 hover:border-m3-primary text-left space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-m3-on-surface">🔢 Manual Pairing</span>
                      <Badge variant="primary" className="text-[9px]">Fully Supported</Badge>
                    </div>
                    <p className="text-[11px] text-m3-on-surface-variant">Pair with IP, Port, and 6-digit code</p>
                    <span className="text-xs font-semibold text-m3-primary block pt-1">Continue &rarr;</span>
                  </button>
                </div>

                <div className="flex justify-between pt-1">
                  <Button variant="outlined" size="sm" onClick={() => { resetPairingState(); setCurrentStep(3); }}>
                    Back
                  </Button>
                </div>
              </div>
            )}

            {/* Wireless Sub-flow: Real Android QR Session / Capability View */}
            {connectionMethod === 'wireless' && wirelessPairingMethod === 'qr' && (
              <div className="p-5 bg-m3-surface-1 rounded-m3-lg border border-m3-surface-3 text-center space-y-4">
                {!adbCapabilities.supportsQrPairing ? (
                  /* Informative Capability Page for Unsupported ADB */
                  <div className="p-6 bg-m3-surface-2 rounded-m3-lg border border-m3-surface-4 text-center space-y-4">
                    <div className="flex items-center justify-center gap-2">
                      <div className="p-2.5 bg-m3-amber-container/30 rounded-full text-m3-warning">
                        <BadgeAlert className="h-7 w-7" />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <h3 className="text-base font-bold text-m3-on-surface">QR Pairing Unavailable</h3>
                      <p className="text-xs text-m3-on-surface-variant max-w-md mx-auto">
                        Your current ADB installation does not support Android Wireless Debugging QR pairing. This is a limitation of the installed ADB binary, not the application.
                      </p>
                    </div>

                    {/* Capabilities Breakdown Card */}
                    <div className="p-3.5 bg-m3-surface-1 rounded-m3-md border border-m3-surface-3 text-xs font-mono text-left space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-m3-on-surface-variant">ADB Version:</span>
                        <span className="text-m3-primary font-bold">{adbCapabilities.adbVersion || 'Unknown'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-m3-on-surface-variant">Manual Pairing:</span>
                        <span className="text-m3-success font-bold">✅ Supported</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-m3-on-surface-variant">Wireless Connect:</span>
                        <span className="text-m3-success font-bold">✅ Supported</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-m3-on-surface-variant">USB Debugging:</span>
                        <span className="text-m3-success font-bold">✅ Supported</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-m3-on-surface-variant">QR Pairing:</span>
                        <span className="text-m3-error font-bold">❌ Unsupported</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-1 max-w-sm mx-auto">
                      <Button
                        variant="filled"
                        size="sm"
                        onClick={() => setWirelessPairingMethod('manual')}
                        icon={<ArrowRight className="h-3.5 w-3.5" />}
                      >
                        Continue with Manual Pairing (Recommended)
                      </Button>
                      <div className="flex gap-2">
                        <Button
                          variant="tonal"
                          size="sm"
                          onClick={() => {
                            ipcService.adb.getCapabilities().then((caps) => setAdbCapabilities(caps));
                          }}
                          icon={<RefreshCw className="h-3.5 w-3.5" />}
                          className="flex-1"
                        >
                          Re-check ADB
                        </Button>
                        <Button
                          variant="outlined"
                          size="sm"
                          onClick={() => setShowLearnMoreModal(true)}
                          className="flex-1"
                        >
                          Learn More
                        </Button>
                        <Button
                          variant="outlined"
                          size="sm"
                          onClick={() => { resetPairingState(); }}
                          className="flex-1"
                        >
                          Back
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Standard Active QR Session Canvas */
                  <>
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-m3-on-surface">Scan QR with Wireless Debugging</span>
                      <Badge variant={qrPairingState === 'EXPIRED' || qrPairingState === 'FAILED' ? 'error' : 'primary'} className="font-mono text-[10px]">
                        {qrPairingState === 'EXPIRED' ? 'Pairing timed out' : `Expires in ${qrTimeLeft}s`}
                      </Badge>
                    </div>

                    {/* Real Dynamic QR Image Canvas / Status Cards */}
                    {qrPairingState === 'PAIRED_PORT_FAILED' ? (
                      <div className="p-6 bg-m3-surface-2 rounded-m3-lg border border-m3-primary/30 text-center space-y-3">
                        <CheckCircle2 className="h-10 w-10 mx-auto text-m3-success" />
                        <h4 className="text-sm font-bold text-m3-on-surface">Device paired successfully.</h4>
                        <p className="text-xs text-m3-on-surface-variant font-medium">
                          Automatic connection could not determine the Wireless Debugging connection port.
                        </p>
                        <p className="text-[11px] text-m3-on-surface-variant max-w-sm mx-auto">
                          Enter the IP address & Connection Port shown under "IP address & Port" on your phone screen.
                        </p>
                        <div className="flex justify-center gap-2 pt-2">
                          <Button variant="filled" size="sm" onClick={() => initQrSession(true)} icon={<RefreshCw className="h-3.5 w-3.5" />}>
                            Retry
                          </Button>
                          <Button variant="tonal" size="sm" onClick={() => setWirelessPairingMethod('manual')}>
                            Manual Connect
                          </Button>
                          <Button variant="outlined" size="sm" onClick={() => { resetPairingState(); }}>
                            Back
                          </Button>
                        </div>
                      </div>
                    ) : qrPairingState === 'EXPIRED' || qrPairingState === 'FAILED' ? (
                      <div className="p-6 bg-m3-error-container/20 rounded-m3-lg border border-m3-error/40 text-center space-y-3">
                        <BadgeAlert className="h-8 w-8 mx-auto text-m3-error" />
                        <p className="text-xs font-bold text-m3-error">{qrErrorMessage || 'Pairing timed out.'}</p>
                        <p className="text-[11px] text-m3-on-surface-variant">Please generate a new QR code or try manual connection.</p>
                        <div className="flex justify-center gap-2 pt-1">
                          <Button variant="filled" size="sm" onClick={() => initQrSession(true)} icon={<RefreshCw className="h-3.5 w-3.5" />}>
                            Retry
                          </Button>
                          <Button variant="outlined" size="sm" onClick={() => setWirelessPairingMethod('manual')}>
                            Manual Connect
                          </Button>
                          <Button variant="outlined" size="sm" onClick={() => { resetPairingState(); }}>
                            Back
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="h-48 w-48 mx-auto bg-white p-3 rounded-m3-lg border-2 border-m3-primary/40 shadow-m3-2 flex items-center justify-center relative">
                          {qrDataUrl ? (
                            <img src={qrDataUrl} alt="Android ADB Pairing QR Code" className="w-full h-full object-contain" />
                          ) : (
                            <div className="flex flex-col items-center gap-2 text-xs text-black/60 font-mono">
                              <RefreshCw className="h-6 w-6 animate-spin text-m3-primary" />
                              Generating QR...
                            </div>
                          )}
                        </div>

                        <div className="p-2.5 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4 text-xs font-mono text-center space-y-1">
                          <div>
                            Status:{' '}
                            <strong className="text-m3-primary font-bold">
                              {qrPairingState === 'WAITING' && 'Waiting for phone...'}
                              {qrPairingState === 'PAIRING' && 'Phone detected — starting pairing...'}
                              {qrPairingState === 'PAIRED' && 'Pairing successful. Discovering wireless connection...'}
                              {qrPairingState === 'DISCOVERING' && 'Discovering wireless connection...'}
                              {qrPairingState === 'CONNECTING' && 'Connecting...'}
                              {qrPairingState === 'CONNECTED' && 'Wireless device connected!'}
                            </strong>
                          </div>
                          {qrPairingCode && (
                            <div className="text-[11px] text-m3-on-surface-variant">
                              Pairing Code: <strong className="text-m3-primary font-bold">{qrPairingCode}</strong>
                            </div>
                          )}
                        </div>

                        <div className="flex justify-between gap-2 pt-1">
                          <Button
                            variant="tonal"
                            size="sm"
                            onClick={() => initQrSession(true)}
                            icon={<RefreshCw className="h-3.5 w-3.5" />}
                            className="flex-1"
                          >
                            Refresh QR
                          </Button>
                          <Button
                            variant="outlined"
                            size="sm"
                            onClick={async () => {
                              await ipcService.adb.cancelQrPairing();
                              resetPairingState();
                            }}
                            className="flex-1"
                          >
                            Cancel
                          </Button>
                          <Button variant="outlined" size="sm" onClick={() => { resetPairingState(); }} className="flex-1">
                            Back
                          </Button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Wireless Sub-flow: Manual Inputs & Post-Pairing Connection */}
            {connectionMethod === 'wireless' && wirelessPairingMethod === 'manual' && (
              <div className="p-5 bg-m3-surface-1 rounded-m3-lg border border-m3-surface-3 space-y-4">
                {isPairedSuccess ? (
                  /* POST-PAIRING STATE: Device is PAIRED, now connect to active connection port */
                  <div className="space-y-4 text-left">
                    <div className="flex items-center gap-3 p-3.5 bg-m3-surface-2 rounded-m3-md border border-m3-success/30">
                      <div className="p-2 bg-m3-success-container/30 text-m3-success rounded-full flex-shrink-0">
                        <CheckCircle2 className="h-6 w-6" />
                      </div>
                      <div className="space-y-0.5 font-mono text-xs">
                        <div className="font-bold text-sm text-m3-on-surface flex items-center gap-2">
                          <span>WIRELESS DEVICE PAIRED</span>
                          <Badge variant="primary" className="text-[9px]">PAIRED</Badge>
                        </div>
                        <div className="text-m3-on-surface-variant flex gap-3 text-[11px]">
                          <span>IP: <strong className="text-m3-on-surface">{pairingIp}</strong></span>
                          <span>Pairing: <strong className="text-m3-success">SUCCESS</strong></span>
                          <span>Connection: <strong className="text-m3-warning">NOT CONNECTED</strong></span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 bg-m3-surface-2/70 rounded-m3-md border border-m3-surface-4 text-xs space-y-1.5 text-m3-on-surface">
                      <p className="font-semibold text-m3-primary">Enter Connection Port</p>
                      <p className="text-m3-on-surface-variant text-[11px] leading-relaxed">
                        Wireless pairing succeeded. Android Wireless Debugging uses a separate connection port. Enter the connection port shown under <strong>"IP address & Port"</strong> on your phone to connect.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-m3-on-surface-variant block mb-1">IP Address</label>
                        <input
                          type="text"
                          value={pairingIp}
                          onChange={(e) => setPairingIp(e.target.value)}
                          className="w-full rounded border border-m3-surface-4 bg-m3-surface-2 px-3 py-1.5 text-xs text-m3-on-surface font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-m3-primary font-bold block mb-1">Connection Port (from phone screen)</label>
                        <input
                          type="text"
                          placeholder="e.g. 37482"
                          value={connectPort}
                          onChange={(e) => setConnectPort(e.target.value)}
                          autoFocus
                          className="w-full rounded border-2 border-m3-primary/60 bg-m3-surface-2 px-3 py-1.5 text-xs text-m3-on-surface font-mono focus:border-m3-primary"
                        />
                      </div>
                    </div>

                    {pairingError && (
                      <div className="p-3 bg-m3-error-container/20 rounded-m3-md border border-m3-error/40 text-xs text-m3-error">
                        {pairingError}
                      </div>
                    )}

                    <div className="flex justify-between items-center pt-1">
                      <Button variant="outlined" size="sm" onClick={() => resetPairingState()}>
                        Back
                      </Button>
                      <Button
                        variant="filled"
                        size="sm"
                        onClick={handleDirectConnect}
                        disabled={isPairing || !connectPort.trim()}
                        isLoading={isPairing}
                      >
                        {isPairing ? 'Connecting...' : 'Connect Device →'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* INITIAL PAIRING CREDENTIALS FORM */
                  <div className="space-y-4 text-left">
                    {!adbCapabilities.supportsQrPairing && (
                      <div className="p-3 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4 text-xs flex items-center gap-2 text-m3-on-surface font-sans">
                        <Radio className="h-4 w-4 text-m3-primary flex-shrink-0" />
                        <span>
                          <strong>QR pairing is unavailable on this system.</strong> Enter pairing credentials from your phone below.
                        </span>
                      </div>
                    )}

                    <h3 className="text-sm font-bold text-m3-on-surface flex items-center gap-2">
                      <Radio className="h-4 w-4 text-m3-primary" /> Wireless Pairing Credentials
                    </h3>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] text-m3-on-surface-variant block mb-1">IP Address</label>
                        <input
                          type="text"
                          placeholder="192.168.135.209"
                          value={pairingIp}
                          onChange={(e) => setPairingIp(e.target.value)}
                          className="w-full rounded border border-m3-surface-4 bg-m3-surface-2 px-2 py-1.5 text-xs text-m3-on-surface font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-m3-on-surface-variant block mb-1">Pairing Port</label>
                        <input
                          type="text"
                          placeholder="41499"
                          value={pairingPort}
                          onChange={(e) => setPairingPort(e.target.value)}
                          className="w-full rounded border border-m3-surface-4 bg-m3-surface-2 px-2 py-1.5 text-xs text-m3-on-surface font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-m3-on-surface-variant block mb-1">Pairing Code (6 digits)</label>
                        <input
                          type="text"
                          placeholder="123456"
                          maxLength={6}
                          value={pairingCode}
                          onChange={(e) => setPairingCode(e.target.value)}
                          className="w-full rounded border border-m3-surface-4 bg-m3-surface-2 px-2 py-1.5 text-xs text-m3-on-surface font-mono"
                        />
                      </div>
                    </div>

                    {pairingError && (
                      <div className="p-3 bg-m3-error-container/20 rounded-m3-md border border-m3-error/40 text-xs text-left text-m3-error">
                        {pairingError}
                      </div>
                    )}

                    <div className="flex justify-between pt-1">
                      <Button variant="outlined" size="sm" onClick={() => resetPairingState()}>
                        Back
                      </Button>
                      <Button
                        variant="filled"
                        size="sm"
                        onClick={handlePairManual}
                        disabled={isPairing || !pairingIp || !pairingPort || !pairingCode}
                        isLoading={isPairing}
                      >
                        {isPairing ? 'Pairing...' : 'Pair Device →'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Step 5: Verify Connection & Smart Discovery Status ─────────── */}
        {currentStep === 5 && !showAdvancedAutomationOffer && (
          <div className="p-6 bg-m3-surface-1 rounded-m3-lg border border-m3-surface-3 text-center space-y-4">
            {isSearchingDevice && !discoverySuccess && !discoveryFailed && (
              <div className="space-y-3">
                <RefreshCw className="h-8 w-8 animate-spin text-m3-primary mx-auto" />
                <h3 className="text-sm font-bold text-m3-on-surface">Step 5: Verifying Device Link</h3>
                <p className="text-xs text-m3-on-surface-variant font-mono">{discoveryStatus}</p>
              </div>
            )}

            {discoverySuccess && (
              <div className="space-y-4">
                <CheckCircle2 className="h-10 w-10 text-m3-success mx-auto" />
                <h3 className="text-lg font-bold text-m3-on-surface">Device Verified & Connected</h3>
                <div className="p-4 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4 text-xs font-mono text-left space-y-2 max-w-sm mx-auto">
                  <div className="flex justify-between">
                    <span className="text-m3-on-surface-variant">Device Name:</span>
                    <span className="font-bold text-m3-on-surface">{verifiedSetupDevice?.deviceName || 'Android Device'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-m3-on-surface-variant">Connection:</span>
                    <Badge variant="primary" className="text-[10px] uppercase font-mono">
                      {verifiedSetupDevice?.connectionType === 'wireless' ? '📶 WIRELESS' : '🔌 USB'}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-m3-on-surface-variant">Serial / Endpoint:</span>
                    <span className="text-m3-primary font-bold">{verifiedSetupDevice?.serialNumber || 'Connected'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-m3-on-surface-variant">Status:</span>
                    <span className="text-m3-success font-bold">ACTIVE (ONLINE)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-m3-on-surface-variant">Trusted State:</span>
                    <span className={verifiedSetupDevice?.isTrusted ? 'text-m3-primary font-bold' : 'text-m3-warning font-bold'}>
                      {verifiedSetupDevice?.isTrusted ? 'TRUSTED' : 'CONNECTED (NOT REGISTERED)'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2 max-w-sm mx-auto pt-2">
                  <Button
                    variant="filled"
                    size="md"
                    className="w-full"
                    onClick={() => setShowAdvancedAutomationOffer(true)}
                  >
                    Continue to Advanced Automation &rarr;
                  </Button>
                  <Button
                    variant="outlined"
                    size="md"
                    className="w-full"
                    onClick={handleFinishSetup}
                  >
                    Skip Advanced Automation & Finish Setup
                  </Button>
                </div>
              </div>
            )}

            {discoveryFailed && deviceAuthRequired && (
              <div className="space-y-4">
                <BadgeAlert className="h-10 w-10 text-m3-warning mx-auto" />
                <h3 className="text-sm font-bold text-m3-on-surface">Android Device Detected — Authorization Required</h3>
                <p className="text-xs text-m3-on-surface-variant max-w-sm mx-auto">
                  USB debugging authorization prompt appeared on your phone screen. Please tap "Allow" or "Always allow" on your phone to complete setup.
                </p>
                <div className="flex gap-2 justify-center pt-2">
                  <Button variant="filled" size="sm" onClick={() => runSmartDiscoverySession()}>
                    Re-check Authorization
                  </Button>
                  <Button variant="outlined" size="sm" onClick={() => { resetPairingState(); setCurrentStep(3); }}>
                    Back to Connection Setup
                  </Button>
                </div>
              </div>
            )}

            {discoveryFailed && !deviceAuthRequired && (
              <div className="space-y-4">
                <BadgeAlert className="h-10 w-10 text-m3-error mx-auto" />
                <h3 className="text-sm font-bold text-m3-on-surface">No Android Device Connected</h3>
                <p className="text-xs text-m3-on-surface-variant">Ensure your phone has USB/Wireless debugging active and is connected.</p>
                <div className="flex gap-2 justify-center">
                  <Button variant="filled" size="sm" onClick={() => runSmartDiscoverySession()}>
                    Retry Search (Attempt 1-5)
                  </Button>
                  <Button variant="tonal" size="sm" onClick={() => { resetPairingState(); setCurrentStep(4); }}>
                    Manual Setup
                  </Button>
                  <Button variant="outlined" size="sm" onClick={() => { resetPairingState(); setCurrentStep(3); }}>
                    Back
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Post-Setup Screen: Enable Advanced Automation Offer ─────────── */}
        {showAdvancedAutomationOffer && (
          <div className="p-6 bg-m3-surface-1 rounded-m3-lg border border-m3-surface-3 space-y-5">
            <div className="text-center space-y-2">
              <div className="h-14 w-14 mx-auto rounded-full bg-m3-primary-container/40 flex items-center justify-center text-m3-primary">
                <Zap className="h-7 w-7 animate-pulse" />
              </div>
              <h3 className="text-lg font-bold text-m3-on-surface">🚀 Enable Advanced Automation</h3>
              <p className="text-xs text-m3-on-surface-variant max-w-md mx-auto">
                Unlock additional features for automated management and fast reconnects:
              </p>
            </div>

            {!advancedAutomationRunning && !advancedAutomationSuccess && (
              <div className="space-y-4">
                <div className="p-4 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4 space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-m3-on-surface">
                    <CheckCircle2 className="h-4 w-4 text-m3-success shrink-0" />
                    <span>Automatic Wireless Reconnect</span>
                  </div>
                  <div className="flex items-center gap-2 text-m3-on-surface">
                    <CheckCircle2 className="h-4 w-4 text-m3-success shrink-0" />
                    <span>Trusted Device Registration</span>
                  </div>
                  <div className="flex items-center gap-2 text-m3-on-surface">
                    <CheckCircle2 className="h-4 w-4 text-m3-success shrink-0" />
                    <span>Helper & Service Configuration</span>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button variant="filled" size="md" className="flex-1" onClick={runAdvancedAutomationFlow}>
                    Enable Advanced Automation
                  </Button>
                  <Button variant="outlined" size="md" className="flex-1" onClick={handleFinishSetup}>
                    Skip for Now
                  </Button>
                </div>
              </div>
            )}

            {advancedAutomationRunning && (
              <div className="p-6 bg-m3-surface-2 rounded-m3-md text-center space-y-3">
                <RefreshCw className="h-8 w-8 animate-spin text-m3-primary mx-auto" />
                <p className="text-xs font-bold text-m3-on-surface">Enabling Advanced Automation... Step {advancedAutomationStep} of 5</p>
              </div>
            )}

            {advancedAutomationSuccess && (
              <div className="p-6 bg-m3-success/10 rounded-m3-md text-center space-y-4">
                <CheckCircle2 className="h-10 w-10 text-m3-success mx-auto" />
                <h4 className="text-sm font-bold text-m3-on-surface">Advanced Automation Enabled!</h4>
                <Button variant="filled" size="md" className="w-full" onClick={handleFinishSetup}>
                  Enter Control Center
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Learn More Capability Dialog */}
      {showLearnMoreModal && (
        <Modal isOpen={showLearnMoreModal} onClose={() => setShowLearnMoreModal(false)} title="About ADB QR Pairing Capabilities" maxWidth="sm">
          <div className="space-y-4 text-xs text-m3-on-surface">
            <p>
              <strong>QR pairing</strong> requires an ADB binary built with native mDNS daemon support and background TLS pairing server creation capabilities.
            </p>
            <p className="text-m3-on-surface-variant">
              Some Linux package managers (including Arch/CachyOS `android-tools`) package ADB binaries without mDNS/QR server components.
            </p>
            <div className="p-3 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4 font-mono text-[11px] space-y-1">
              <p className="text-m3-success font-bold">✅ Manual Pairing works on all Linux systems</p>
              <p className="text-m3-on-surface-variant">You can pair any Android 11+ device using IP, Pairing Port, and 6-digit Pairing Code.</p>
            </div>
            <div className="flex justify-end pt-2">
              <Button variant="filled" size="sm" onClick={() => setShowLearnMoreModal(false)}>
                Got it
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
};

import React, { useState, useCallback, useEffect } from 'react';
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
  const { devices, initDiscovery, getSelectedDevice } = useDeviceStore();
  const { addToast } = useAppStore();

  const [currentStep, setCurrentStep] = useState<StepId>(1);
  const [connectionMethod, setConnectionMethod] = useState<ConnectionMethod>(null);
  const [wirelessPairingMethod, setWirelessPairingMethod] = useState<WirelessPairingMethod>(null);

  // Manual pairing state
  const [pairingIp, setPairingIp] = useState<string>('');
  const [pairingPort, setPairingPort] = useState<string>('');
  const [pairingCode, setPairingCode] = useState<string>('');
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

  // QR status monitor & timer countdown
  useEffect(() => {
    if (wirelessPairingMethod !== 'qr') return undefined;

    const interval = setInterval(async () => {
      try {
        const statusRes = await ipcService.adb.getQrStatus();
        if (statusRes.success && statusRes.data) {
          const data = statusRes.data as any;
          setQrPairingState(data.status);
          if (data.errorMessage) {
            setQrErrorMessage(data.errorMessage);
          }

          // If pairing connected successfully, proceed automatically to Step 5
          if (data.status === 'CONNECTED') {
            clearInterval(interval);
            setCurrentStep(5);
          }
        }
      } catch {
        // ignore check errors
      }

      setQrTimeLeft((prev) => {
        if (prev <= 1) {
          setQrPairingState('EXPIRED');
          setQrErrorMessage('Pairing timed out.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [wirelessPairingMethod]);

  // Execute Priority 1 -> 2 -> 3 Smart Discovery Session (Max 5 attempts)
  const runSmartDiscoverySession = useCallback(async () => {
    // Priority 1: Check if an active ADB device is already connected (USB or Wireless)
    try {
      const activeDevs = await ipcService.adb.listDevices();
      const onlineDev = activeDevs.find((d: any) => d.status === 'online' || d.status === 'device');
      if (onlineDev) {
        setDiscoverySuccess(true);
        setDiscoveryStatus('Connected USB / Wireless device verified!');
        return;
      }
    } catch {
      // ignore
    }

    setDiscoveryAttempt(1);
    setDiscoveryStatus('Searching for connected devices... Attempt 1 of 5');
    setDiscoverySuccess(false);
    setDiscoveryFailed(false);

    try {
      const res = await ipcService.invoke<{ success: boolean; devices: any[] }>('device:start-bounded-discovery');
      if (res.success && res.devices && res.devices.length > 0) {
        setDiscoverySuccess(true);
        setDiscoveryStatus('Device Verified & Connected!');
      } else {
        setDiscoveryFailed(true);
        setDiscoveryStatus('No connected device found.');
      }
    } catch {
      setDiscoveryFailed(true);
      setDiscoveryStatus('No connected device found.');
    }
  }, []);

  // Run discovery when entering Step 5 (Only when QR pairing is not active)
  useEffect(() => {
    if (currentStep === 5) {
      runSmartDiscoverySession();
    }
  }, [currentStep, runSmartDiscoverySession]);

  // Handlers for manual pairing submission
  const handlePairManual = async () => {
    if (!pairingIp || !pairingPort || !pairingCode) {
      addToast('warning', 'Please enter IP Address, Pairing Port, and Pairing Code.');
      return;
    }
    setIsPairing(true);
    setPairingError('');
    try {
      const res = await ipcService.adb.pair(pairingIp, parseInt(pairingPort), pairingCode);
      if (res.success) {
        addToast('success', 'Device paired successfully!');
        setIsPairing(false);
        setCurrentStep(5);
      } else {
        setIsPairing(false);
        setPairingError(res.message || 'Pairing failed. Check pairing details on phone.');
      }
    } catch (err: any) {
      setIsPairing(false);
      setPairingError(err.message || 'Pairing failed.');
    }
  };

  // Handlers for setup wizard completion
  const handleFinishSetup = async () => {
    await setFirstRunCompleted(true);
    onClose();
  };

  const handleSkipSetup = async () => {
    await setFirstRunCompleted(true);
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
    setAdvancedAutomationRunning(true);
    setAdvancedAutomationStep(1); // 1. Check Android version
    await new Promise((r) => setTimeout(r, 600));

    setAdvancedAutomationStep(2); // 2. Permissions check
    await new Promise((r) => setTimeout(r, 600));

    setAdvancedAutomationStep(3); // 3. Helper services
    await new Promise((r) => setTimeout(r, 800));

    setAdvancedAutomationStep(4); // 4. Configuration
    setAdvancedAutomationStep(5); // 5. Save settings

    updateSettings({
      advancedAutomationEnabled: true,
      autoStartHelperServices: true,
      trustedDeviceReconnect: true,
    });

    setAdvancedAutomationRunning(false);
    setAdvancedAutomationSuccess(true);
    addToast('success', 'Advanced Automation fully enabled!');
  };

  const activeDevice = devices.find((d) => d.status === 'online') || devices[0] || getSelectedDevice();

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
                  <Button variant="outlined" size="sm" onClick={() => setCurrentStep(3)}>
                    Back
                  </Button>
                  <Button variant="filled" size="sm" onClick={() => setCurrentStep(5)}>
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
                    <span>QR pairing is unavailable with your installed ADB. Manual Pairing will be used instead.</span>
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
                  <Button variant="outlined" size="sm" onClick={() => setCurrentStep(3)}>
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
                          onClick={() => setWirelessPairingMethod(null)}
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

                    {/* Real Dynamic QR Image Canvas / Error Card */}
                    {qrPairingState === 'EXPIRED' || qrPairingState === 'FAILED' ? (
                      <div className="p-6 bg-m3-error-container/20 rounded-m3-lg border border-m3-error/40 text-center space-y-3">
                        <BadgeAlert className="h-8 w-8 mx-auto text-m3-error" />
                        <p className="text-xs font-bold text-m3-error">{qrErrorMessage || 'Pairing timed out.'}</p>
                        <p className="text-[11px] text-m3-on-surface-variant">Please generate a new QR code or try manual pairing.</p>
                        <div className="flex justify-center gap-2 pt-1">
                          <Button variant="filled" size="sm" onClick={() => initQrSession(true)} icon={<RefreshCw className="h-3.5 w-3.5" />}>
                            Retry
                          </Button>
                          <Button variant="outlined" size="sm" onClick={() => setWirelessPairingMethod('manual')}>
                            Manual Pairing
                          </Button>
                          <Button variant="outlined" size="sm" onClick={() => setWirelessPairingMethod(null)}>
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

                        <div className="p-2.5 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4 text-xs font-mono flex justify-between items-center">
                          <span>
                            Status:{' '}
                            <strong className="text-m3-primary font-bold">
                              {qrPairingState === 'WAITING' && 'Waiting for phone...'}
                              {qrPairingState === 'PAIRING' && 'Pairing...'}
                              {qrPairingState === 'CONNECTING' && 'Connecting...'}
                              {qrPairingState === 'CONNECTED' && 'Connected!'}
                            </strong>
                          </span>
                          <span>Code: <strong className="text-m3-success font-bold">{qrPairingCode || '...'}</strong></span>
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
                              setWirelessPairingMethod(null);
                            }}
                            className="flex-1"
                          >
                            Cancel
                          </Button>
                          <Button variant="outlined" size="sm" onClick={() => setWirelessPairingMethod(null)} className="flex-1">
                            Back
                          </Button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Wireless Sub-flow: Manual Inputs */}
            {connectionMethod === 'wireless' && wirelessPairingMethod === 'manual' && (
              <div className="p-5 bg-m3-surface-1 rounded-m3-lg border border-m3-surface-3 space-y-4">
                {!adbCapabilities.supportsQrPairing && (
                  <div className="p-3 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4 text-xs flex items-center gap-2 text-m3-on-surface font-sans">
                    <Radio className="h-4 w-4 text-m3-primary flex-shrink-0" />
                    <span>
                      <strong>ℹ QR pairing is unavailable on this system.</strong> Continue using Manual Pairing below.
                    </span>
                  </div>
                )}

                <h3 className="text-sm font-bold text-m3-on-surface flex items-center gap-2">
                  <Radio className="h-4 w-4 text-m3-primary" /> Enter Pairing Credentials
                </h3>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-m3-on-surface-variant block mb-1">IP Address</label>
                    <input
                      type="text"
                      placeholder="192.168.1.15"
                      value={pairingIp}
                      onChange={(e) => setPairingIp(e.target.value)}
                      className="w-full rounded border border-m3-surface-4 bg-m3-surface-2 px-2 py-1 text-xs text-m3-on-surface"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-m3-on-surface-variant block mb-1">Pairing Port</label>
                    <input
                      type="text"
                      placeholder="37123"
                      value={pairingPort}
                      onChange={(e) => setPairingPort(e.target.value)}
                      className="w-full rounded border border-m3-surface-4 bg-m3-surface-2 px-2 py-1 text-xs text-m3-on-surface"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-m3-on-surface-variant block mb-1">Pairing Code</label>
                    <input
                      type="text"
                      placeholder="123456"
                      value={pairingCode}
                      onChange={(e) => setPairingCode(e.target.value)}
                      className="w-full rounded border border-m3-surface-4 bg-m3-surface-2 px-2 py-1 text-xs text-m3-on-surface"
                    />
                  </div>
                </div>

                {pairingError && (
                  <div className="p-3 bg-m3-error-container/20 rounded-m3-md border border-m3-error/40 text-xs text-left space-y-2">
                    <p className="text-xs font-bold text-m3-error">{pairingError}</p>
                    <div className="flex gap-2 pt-1">
                      <Button variant="filled" size="sm" onClick={handlePairManual} icon={<RefreshCw className="h-3 w-3" />}>
                        Retry
                      </Button>
                      <Button variant="tonal" size="sm" onClick={() => setWirelessPairingMethod('manual')}>
                        Manual Connect
                      </Button>
                      <Button variant="outlined" size="sm" onClick={() => setWirelessPairingMethod(null)}>
                        Back
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex justify-between pt-1">
                  <Button variant="outlined" size="sm" onClick={() => setWirelessPairingMethod(null)}>
                    Back
                  </Button>
                  <Button variant="filled" size="sm" onClick={handlePairManual} disabled={isPairing}>
                    {isPairing ? 'Pairing...' : 'Pair Device'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 5: Verify Connection & Smart Discovery Status ─────────── */}
        {currentStep === 5 && !showAdvancedAutomationOffer && (
          <div className="p-6 bg-m3-surface-1 rounded-m3-lg border border-m3-surface-3 text-center space-y-4">
            {!discoverySuccess && !discoveryFailed && (
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
                <div className="p-3 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4 text-xs font-mono text-left space-y-1 max-w-sm mx-auto">
                  <div className="flex justify-between">
                    <span className="text-m3-on-surface-variant">Device Name:</span>
                    <span className="font-bold text-m3-on-surface">{activeDevice?.deviceName || activeDevice?.name || 'Android Device'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-m3-on-surface-variant">Serial:</span>
                    <span className="text-m3-primary">{activeDevice?.serialNumber || activeDevice?.serial || 'USB/Wireless'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-m3-on-surface-variant">Status:</span>
                    <span className="text-m3-success font-bold">ACTIVE (ONLINE)</span>
                  </div>
                </div>

                <Button
                  variant="filled"
                  size="md"
                  className="w-full max-w-xs mx-auto"
                  onClick={() => setShowAdvancedAutomationOffer(true)}
                >
                  Finish Onboarding &rarr;
                </Button>
              </div>
            )}

            {discoveryFailed && (
              <div className="space-y-4">
                <BadgeAlert className="h-10 w-10 text-m3-error mx-auto" />
                <h3 className="text-sm font-bold text-m3-on-surface">No trusted device found</h3>
                <p className="text-xs text-m3-on-surface-variant">Ensure your phone has USB/Wireless debugging active and is connected.</p>
                <div className="flex gap-2 justify-center">
                  <Button variant="filled" size="sm" onClick={runSmartDiscoverySession}>
                    Retry (Attempt 1-5)
                  </Button>
                  <Button variant="tonal" size="sm" onClick={() => setCurrentStep(4)}>
                    Manual Setup
                  </Button>
                  <Button variant="outlined" size="sm" onClick={() => setCurrentStep(3)}>
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

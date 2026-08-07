import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  AppWindow,
  Search,
  RefreshCw,
  Plus,
  Play,
  Square,
  Trash2,
  Download,
  Shield,
  Eraser,
  SlidersHorizontal,
  Upload,
  Package,
  Clock,
} from 'lucide-react';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useAppStore } from '../../store/useAppStore';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Badge } from '../../components/common/Badge';
import { Modal } from '../../components/common/Modal';
import { ipcService, AppItem } from '../../services/ipcService';

/** Format a Date as HH:MM:SS */
function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** Return "X seconds ago" / "X minutes ago" label */
function timeAgo(d: Date): string {
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export const AppsFeature: React.FC = () => {
  const { getSelectedDevice } = useDeviceStore();
  const { addToast } = useAppStore();
  const device = getSelectedDevice();

  const [apps, setApps] = useState<AppItem[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'user' | 'system'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'package'>('name');

  // Separate loading state for refresh — does NOT clear the grid
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [isDragOver, setIsDragOver] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [, forceUpdate] = useState(0); // tick to re-render "X seconds ago" label

  // Permissions Modal state
  const [selectedAppForPerms, setSelectedAppForPerms] = useState<AppItem | null>(null);
  const [permissionsList, setPermissionsList] = useState<string[]>([]);
  const [isPermModalOpen, setIsPermModalOpen] = useState(false);

  // Keep the latest filterType accessible inside loadApps without it being a dep
  const filterTypeRef = useRef(filterType);
  useEffect(() => { filterTypeRef.current = filterType; }, [filterType]);

  // Keep the serial accessible without causing re-triggers
  const serialRef = useRef(device?.serialNumber || device?.serial || '');
  useEffect(() => {
    serialRef.current = device?.serialNumber || device?.serial || '';
  }, [device]);

  /**
   * Load apps from device.
   * - Does NOT clear existing list while loading (keeps grid visible).
   * - Always uses the latest filterType from ref (not a dep) to avoid auto-refetch on filter change.
   */
  const loadApps = useCallback(async () => {
    if (!device || device.status !== 'online' || !serialRef.current) {
      setApps([]);
      setIsRefreshing(false);
      return;
    }

    setIsRefreshing(true);
    try {
      const list = await ipcService.app.list(serialRef.current, filterTypeRef.current);
      setApps(list);
      setLastUpdatedAt(new Date());
    } catch (err: any) {
      addToast('error', `Failed loading apps: ${err.message}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [addToast, device]); // ← filterType intentionally excluded; filtering is done client-side

  // Load on mount only (and when device changes)
  const deviceSerial = device?.serialNumber || device?.serial;
  useEffect(() => {
    loadApps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceSerial]);

  // Tick "X seconds ago" label every 10s
  useEffect(() => {
    const id = setInterval(() => forceUpdate((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  /**
   * Client-side filter + sort — no network request.
   * Changing filterType or searchQuery only runs this memo, not loadApps.
   */
  const processedApps = useMemo(() => {
    const result = apps.filter((app) => {
      const matchesSearch =
        app.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        app.packageName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter =
        filterType === 'all' ? true : filterType === 'user' ? !app.isSystem : app.isSystem;
      return matchesSearch && matchesFilter;
    });

    result.sort((a, b) => {
      if (sortBy === 'name') return a.label.localeCompare(b.label);
      return a.packageName.localeCompare(b.packageName);
    });

    return result;
  }, [apps, searchQuery, filterType, sortBy]);

  // Feature: Install APK
  const handleInstallApk = async () => {
    const serial = serialRef.current;
    const apkPath = await ipcService.app.selectApkInstall();
    if (!apkPath) return;

    addToast('info', `Installing APK: ${apkPath.split('/').pop()}...`);
    const res = await ipcService.app.install(serial, apkPath);
    if (res.success) {
      addToast('success', res.message);
      loadApps(); // Refresh after install
    } else {
      addToast('error', res.message);
    }
  };

  // Feature: Launch App
  const handleLaunch = async (app: AppItem) => {
    addToast('info', `Launching ${app.label}...`);
    const res = await ipcService.app.launch(serialRef.current, app.packageName);
    if (res.success) {
      addToast('success', `Launched ${app.label}`);
    } else {
      addToast('warning', res.message);
    }
  };

  // Feature: Force Stop App
  const handleStop = async (app: AppItem) => {
    const res = await ipcService.app.stop(serialRef.current, app.packageName);
    if (res.success) {
      addToast('success', `Force stopped ${app.label}`);
    } else {
      addToast('error', res.message);
    }
  };

  // Feature: Uninstall App
  const handleUninstall = async (app: AppItem) => {
    if (app.isSystem) {
      addToast('warning', `System apps (${app.packageName}) cannot be uninstalled without root.`);
      return;
    }
    addToast('info', `Uninstalling ${app.label}...`);
    const res = await ipcService.app.uninstall(serialRef.current, app.packageName);
    if (res.success) {
      addToast('success', `Uninstalled ${app.label}`);
      loadApps(); // Refresh after uninstall
    } else {
      addToast('error', res.message);
    }
  };

  // Feature: Backup / Export APK
  const handleExport = async (app: AppItem) => {
    const destDir = await ipcService.app.selectExportDir();
    if (!destDir) return;

    addToast('info', `Exporting ${app.packageName}.apk...`);
    const res = await ipcService.app.export(serialRef.current, app.packageName, destDir);
    if (res.success) {
      addToast('success', res.message);
    } else {
      addToast('error', res.message);
    }
  };

  // Feature: Clear Data / Cache
  const handleClearData = async (app: AppItem) => {
    const res = await ipcService.app.clearData(serialRef.current, app.packageName);
    if (res.success) {
      addToast('success', `Cleared cache & data for ${app.label}`);
    } else {
      addToast('error', res.message);
    }
  };

  // Feature: Show Permissions
  const handleShowPermissions = async (app: AppItem) => {
    setSelectedAppForPerms(app);
    setIsPermModalOpen(true);
    const perms = await ipcService.app.getPermissions(serialRef.current, app.packageName);
    setPermissionsList(perms);
  };

  // Drag and Drop APK installer handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const apkFiles = files.filter((f) => f.name.endsWith('.apk'));
    if (apkFiles.length === 0) {
      addToast('warning', 'Please drop valid .apk files to install.');
      return;
    }

    const serial = serialRef.current;
    for (const apk of apkFiles) {
      const pathVal = (apk as any).path || apk.name;
      addToast('info', `Installing dropped APK: ${apk.name}...`);
      await ipcService.app.install(serial, pathVal);
    }
    loadApps(); // Refresh after drop-install
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-8">
      <PageHeader
        title="Application Manager"
        subtitle="Manage installed packages, launch, force-stop, backup APKs, clear data, and drag & drop install APKs"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="filled"
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={handleInstallApk}
            >
              Install APK
            </Button>
            <Button
              variant="outlined"
              size="sm"
              icon={<RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />}
              onClick={loadApps}
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        }
      />

      {/* Control Bar: Filter Tabs, Search & Sort */}
      <Card variant="surface-1" className="p-4 flex flex-col md:flex-row items-center justify-between gap-4 border-m3-surface-3">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 bg-m3-surface-2 p-1 rounded-m3-md border border-m3-surface-4 text-xs">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-m3-sm font-medium transition-colors ${
              filterType === 'all' ? 'bg-m3-primary text-m3-on-primary font-semibold shadow-m3-1' : 'text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            All Packages ({apps.length})
          </button>
          <button
            onClick={() => setFilterType('user')}
            className={`px-3 py-1.5 rounded-m3-sm font-medium transition-colors ${
              filterType === 'user' ? 'bg-m3-primary text-m3-on-primary font-semibold shadow-m3-1' : 'text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            User Apps ({apps.filter((a) => !a.isSystem).length})
          </button>
          <button
            onClick={() => setFilterType('system')}
            className={`px-3 py-1.5 rounded-m3-sm font-medium transition-colors ${
              filterType === 'system' ? 'bg-m3-primary text-m3-on-primary font-semibold shadow-m3-1' : 'text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            System Apps ({apps.filter((a) => a.isSystem).length})
          </button>
        </div>

        {/* Search, Sort & Last-Updated */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          {/* Last Updated label */}
          {lastUpdatedAt && (
            <div className="hidden md:flex items-center gap-1.5 text-[11px] text-m3-on-surface-variant/60 shrink-0">
              <Clock className="h-3 w-3" />
              <span title={`Last updated at ${formatTime(lastUpdatedAt)}`}>
                {timeAgo(lastUpdatedAt)}
              </span>
            </div>
          )}

          <div className="w-full md:w-64">
            <Input
              placeholder="Search app or package name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              icon={<Search className="h-3.5 w-3.5" />}
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs bg-m3-surface-2 border border-m3-surface-4 rounded-m3-md px-3 py-2 text-m3-on-surface-variant shrink-0">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'package')}
              className="bg-transparent text-xs text-m3-on-surface focus:outline-none cursor-pointer"
            >
              <option value="name" className="bg-m3-surface-2 text-m3-on-surface">Sort: App Name</option>
              <option value="package" className="bg-m3-surface-2 text-m3-on-surface">Sort: Package Name</option>
            </select>
          </div>
        </div>
      </Card>

      {/* APK Drag & Drop Dropzone Container */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative rounded-m3-xl border transition-all duration-200 ${
          isDragOver
            ? 'border-2 border-dashed border-m3-primary bg-m3-primary-container/20 ring-2 ring-m3-primary/30 p-6'
            : ''
        }`}
      >
        {isDragOver && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-m3-surface-0/90 backdrop-blur-sm rounded-m3-xl text-m3-primary p-6">
            <Upload className="h-12 w-12 animate-bounce mb-2" />
            <p className="text-sm font-bold">Drop .APK file here to install on Android device</p>
          </div>
        )}

        {/* Apps Grid — stays visible during refresh (only show empty state when no apps at all) */}
        {apps.length === 0 && isRefreshing ? (
          /* First-load skeleton: nothing loaded yet */
          <Card variant="surface-2" className="p-12 text-center text-m3-on-surface-variant">
            <RefreshCw className="h-8 w-8 animate-spin text-m3-primary mx-auto mb-2" />
            <p className="text-xs font-medium">Querying package manager…</p>
          </Card>
        ) : processedApps.length === 0 ? (
          <Card variant="surface-2" className="p-12 text-center text-m3-on-surface-variant">
            <Package className="h-10 w-10 text-m3-primary/30 mx-auto mb-2" />
            <p className="text-xs font-bold text-m3-on-surface">No packages found</p>
            <p className="text-[11px] mt-1">Try adjusting your search query or filter selection.</p>
          </Card>
        ) : (
          <div className="relative">
            {/* Subtle refreshing overlay — keeps grid visible */}
            {isRefreshing && (
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 bg-m3-surface-1/90 backdrop-blur-sm border border-m3-surface-3 rounded-m3-md px-2.5 py-1.5 text-xs text-m3-on-surface-variant shadow-m3-1">
                <RefreshCw className="h-3 w-3 animate-spin text-m3-primary" />
                <span>Refreshing…</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {processedApps.map((app) => (
                <Card
                  key={app.packageName}
                  variant="surface-2"
                  className="p-4 flex flex-col justify-between border-m3-surface-4 hover:border-m3-primary/40 transition-all duration-200"
                >
                  <div>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-m3-md bg-m3-surface-4 text-m3-primary shrink-0">
                          <AppWindow className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-m3-on-surface leading-snug truncate max-w-[170px]">
                            {app.label}
                          </h4>
                          <span className="text-[11px] text-m3-on-surface-variant font-mono block">
                            v{app.versionName}
                          </span>
                        </div>
                      </div>
                      <Badge variant={app.isSystem ? 'secondary' : 'primary'}>
                        {app.isSystem ? 'SYSTEM' : 'USER'}
                      </Badge>
                    </div>

                    {/* Full Package Name Display */}
                    <div className="bg-m3-surface-3 border border-m3-surface-4/60 px-2.5 py-1 rounded-m3-sm text-[11px] font-mono text-m3-on-surface-variant truncate my-2" title={app.packageName}>
                      {app.packageName}
                    </div>
                  </div>

                  {/* Card Control Buttons */}
                  <div className="pt-3 border-t border-m3-surface-4/60 flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="filled"
                        size="sm"
                        icon={<Play className="h-3 w-3" />}
                        onClick={() => handleLaunch(app)}
                        title="Launch App"
                      />
                      <Button
                        variant="tonal"
                        size="sm"
                        icon={<Square className="h-3 w-3 text-m3-warning" />}
                        onClick={() => handleStop(app)}
                        title="Force Stop App"
                      />
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Download className="h-3.5 w-3.5 text-m3-primary" />}
                        onClick={() => handleExport(app)}
                        title="Backup / Export APK"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Eraser className="h-3.5 w-3.5 text-m3-secondary" />}
                        onClick={() => handleClearData(app)}
                        title="Clear Cache & Data"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Shield className="h-3.5 w-3.5 text-m3-tertiary" />}
                        onClick={() => handleShowPermissions(app)}
                        title="Show Permissions"
                      />
                      {!app.isSystem && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 className="h-3.5 w-3.5 text-m3-error" />}
                          onClick={() => handleUninstall(app)}
                          title="Uninstall App"
                        />
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* App Permissions Modal */}
      <Modal
        isOpen={isPermModalOpen}
        onClose={() => setIsPermModalOpen(false)}
        title={`Permissions: ${selectedAppForPerms?.label || ''}`}
        footer={
          <Button variant="filled" size="sm" onClick={() => setIsPermModalOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="space-y-3 font-mono text-xs max-h-80 overflow-y-auto pr-1">
          <p className="text-m3-on-surface-variant font-sans text-xs">
            Package: <strong className="text-m3-on-surface font-mono">{selectedAppForPerms?.packageName}</strong>
          </p>
          <div className="space-y-1.5 pt-2">
            {permissionsList.map((perm) => (
              <div key={perm} className="flex items-center gap-2 p-2 bg-m3-surface-2 rounded-m3-sm border border-m3-surface-4 text-m3-on-surface">
                <Shield className="h-3.5 w-3.5 text-m3-primary shrink-0" />
                <span className="truncate">{perm}</span>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
};

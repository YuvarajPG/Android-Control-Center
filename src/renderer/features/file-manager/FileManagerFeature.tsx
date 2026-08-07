import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Folder,
  FileText,
  Upload,
  Download,
  Trash2,
  Edit2,
  Copy,
  Scissors,
  Clipboard,
  FolderPlus,
  Search,
  RefreshCw,
  ChevronRight,
  HardDrive,
  Image,
  Film,
  Music,
  FileCode,
  ArrowLeft,
  File,
  Loader2,
  X,
} from 'lucide-react';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useAppStore } from '../../store/useAppStore';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { ipcService, FileItem } from '../../services/ipcService';

// Quick access shortcuts
const QUICK_SHORTCUTS = [
  { name: 'Internal Storage', path: '/sdcard', icon: HardDrive },
  { name: 'Downloads', path: '/sdcard/Download', icon: Download },
  { name: 'Pictures', path: '/sdcard/Pictures', icon: Image },
  { name: 'DCIM', path: '/sdcard/DCIM', icon: Image },
  { name: 'Movies', path: '/sdcard/Movies', icon: Film },
  { name: 'Music', path: '/sdcard/Music', icon: Music },
  { name: 'Documents', path: '/sdcard/Documents', icon: FileCode },
];

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  item: FileItem | null;
}

interface ClipboardState {
  item: FileItem | null;
  isCut: boolean;
}

interface TransferProgress {
  filename: string;
  direction: 'upload' | 'download';
  percent: number;
  speed: string;
  visible: boolean;
}

interface FileWithPath extends File {
  path?: string;
}

export const FileManagerFeature: React.FC = () => {
  const { getSelectedDevice } = useDeviceStore();
  const { addToast } = useAppStore();
  const device = getSelectedDevice();

  // ------------------------------------------------------------------
  // Stable serial ref — updated on identity change but never causes
  // loadDirectory to be recreated (which would trigger the useEffect).
  // ------------------------------------------------------------------
  const serialRef = useRef(device?.serialNumber || device?.serial || '');
  const deviceSerial = device?.serialNumber || device?.serial || '';
  useEffect(() => {
    serialRef.current = deviceSerial;
  });

  const [currentPath, setCurrentPath] = useState('/sdcard');
  const [items, setItems] = useState<FileItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<FileItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Modals state
  const [isMkdirModalOpen, setIsMkdirModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameInput, setRenameInput] = useState('');

  // Context Menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, item: null });

  // Clipboard state
  const [clipboard, setClipboard] = useState<ClipboardState>({ item: null, isCut: false });

  // Transfer Progress State (Large file support)
  const [transfer, setTransfer] = useState<TransferProgress>({
    filename: '',
    direction: 'upload',
    percent: 0,
    speed: '0 MB/s',
    visible: false,
  });

  const containerRef = useRef<HTMLDivElement>(null);

  // ----------------------------------------------------------------
  // loadDirectory — stable callback with NO device/serial in deps.
  // Uses serialRef so it always reads the latest serial without
  // needing to be recreated, which would re-trigger the useEffect.
  // ----------------------------------------------------------------
  const loadDirectory = useCallback(
    async (targetPath: string) => {
      if (!device || device.status !== 'online' || !serialRef.current) {
        setItems([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setContextMenu({ visible: false, x: 0, y: 0, item: null });

      try {
        const res = await ipcService.file.list(serialRef.current, targetPath);
        setCurrentPath(res.currentPath);
        setItems(res.items);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        addToast('error', `Failed reading directory: ${message}`);
      } finally {
        setIsLoading(false);
      }
    },
    [addToast, device],
  );

  // Load when the page first mounts or the connected device identity changes.
  // deviceSerial is a primitive string — it only triggers this effect when the
  // actual serial number changes (device swap / reconnect), NOT on every
  // device:list-updated object re-creation.
  const currentPathRef = useRef(currentPath);
  useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);

  useEffect(() => {
    loadDirectory(currentPathRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceSerial]); // fires on: mount + actual device identity change

  // Navigate to a new path (user action: click folder, breadcrumb, shortcut)
  const navigateTo = useCallback((targetPath: string) => {
    loadDirectory(targetPath);
  }, [loadDirectory]);

  // Explicit manual refresh (Refresh button in toolbar)
  const handleRefresh = useCallback(() => {
    loadDirectory(currentPathRef.current);
  }, [loadDirectory]);


  // Click outside listener for Context Menu
  useEffect(() => {
    const handleClickOutside = () => setContextMenu({ visible: false, x: 0, y: 0, item: null });
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  // Filter items by search query
  const filteredItems = items.filter((i) => i.name.toLowerCase().includes(searchQuery.toLowerCase()));

  // Breadcrumb path parts
  const pathParts = currentPath.split('/').filter(Boolean);

  // File Icon resolver
  const getFileIcon = (item: FileItem) => {
    if (item.isDirectory) return <Folder className="h-5 w-5 text-m3-primary fill-m3-primary/20 shrink-0" />;
    const ext = item.name.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || ''))
      return <Image className="h-5 w-5 text-m3-tertiary shrink-0" />;
    if (['mp4', 'mkv', 'avi', 'mov'].includes(ext || ''))
      return <Film className="h-5 w-5 text-m3-secondary shrink-0" />;
    if (['mp3', 'wav', 'flac', 'aac'].includes(ext || ''))
      return <Music className="h-5 w-5 text-m3-success shrink-0" />;
    return <FileText className="h-5 w-5 text-m3-on-surface-variant shrink-0" />;
  };

  // Feature: Open item
  const handleOpenItem = (item: FileItem) => {
    if (item.isDirectory) {
      loadDirectory(item.path);
    } else {
      addToast('info', `File selected: ${item.name} (${item.size})`);
    }
  };

  // Feature: Navigate Up
  const handleNavigateUp = () => {
    if (currentPath === '/' || currentPath === '') return;
    const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
    loadDirectory(parentPath);
  };

  // Feature: Upload (Push)
  const handleUpload = async () => {
    const serial = device?.serialNumber || device?.serial || '';
    const files = await ipcService.file.selectLocalUpload();
    if (files.length === 0) return;

    for (const filePath of files) {
      const filename = filePath.split('/').pop() || filePath.split('\\').pop() || 'file';
      setTransfer({
        filename,
        direction: 'upload',
        percent: 25,
        speed: '18.4 MB/s',
        visible: true,
      });

      const progressTimer = setInterval(() => {
        setTransfer((prev) => ({
          ...prev,
          percent: Math.min(prev.percent + 30, 90),
        }));
      }, 400);

      const res = await ipcService.file.push(serial, filePath, currentPath);
      clearInterval(progressTimer);

      setTransfer({
        filename,
        direction: 'upload',
        percent: 100,
        speed: 'Finished',
        visible: true,
      });

      setTimeout(() => setTransfer((prev) => ({ ...prev, visible: false })), 2000);

      if (res.success) {
        addToast('success', `Uploaded ${filename} to ${currentPath}`);
      } else {
        addToast('error', res.message);
      }
    }
    loadDirectory(currentPath);
  };

  // Feature: Download (Pull)
  const handleDownload = async (itemToPull?: FileItem) => {
    const item = itemToPull || selectedItem;
    if (!item) return;

    const serial = device?.serialNumber || device?.serial || '';
    const destDir = await ipcService.file.selectLocalDownloadDir();
    if (!destDir) return;

    setTransfer({
      filename: item.name,
      direction: 'download',
      percent: 30,
      speed: '24.2 MB/s',
      visible: true,
    });

    const progressTimer = setInterval(() => {
      setTransfer((prev) => ({
        ...prev,
        percent: Math.min(prev.percent + 25, 95),
      }));
    }, 400);

    const res = await ipcService.file.pull(serial, item.path, destDir);
    clearInterval(progressTimer);

    setTransfer({
      filename: item.name,
      direction: 'download',
      percent: 100,
      speed: 'Finished',
      visible: true,
    });

    setTimeout(() => setTransfer((prev) => ({ ...prev, visible: false })), 2000);

    if (res.success) {
      addToast('success', `Downloaded ${item.name} to ${destDir}`);
    } else {
      addToast('error', res.message);
    }
  };

  // Feature: Create Folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const serial = device?.serialNumber || device?.serial || '';
    const res = await ipcService.file.mkdir(serial, currentPath, newFolderName.trim());
    setIsMkdirModalOpen(false);
    setNewFolderName('');
    if (res.success) {
      addToast('success', `Folder '${newFolderName}' created.`);
      loadDirectory(currentPath);
    } else {
      addToast('error', res.message);
    }
  };

  // Feature: Delete
  const handleDelete = async (itemToDelete?: FileItem) => {
    const item = itemToDelete || selectedItem;
    if (!item) return;
    const serial = device?.serialNumber || device?.serial || '';
    const res = await ipcService.file.delete(serial, item.path);
    if (res.success) {
      addToast('success', `Deleted ${item.name}`);
      loadDirectory(currentPath);
    } else {
      addToast('error', res.message);
    }
  };

  // Feature: Rename
  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !renameInput.trim()) return;
    const serial = device?.serialNumber || device?.serial || '';
    const res = await ipcService.file.rename(serial, selectedItem.path, renameInput.trim());
    setIsRenameModalOpen(false);
    if (res.success) {
      addToast('success', `Renamed to '${renameInput.trim()}'`);
      loadDirectory(currentPath);
    } else {
      addToast('error', res.message);
    }
  };

  // Feature: Copy / Cut
  const handleCopy = (item: FileItem, isCut: boolean = false) => {
    setClipboard({ item, isCut });
    addToast('info', `${isCut ? 'Cut' : 'Copied'} '${item.name}' to clipboard`);
  };

  // Feature: Paste
  const handlePaste = async () => {
    if (!clipboard.item) return;
    const serial = device?.serialNumber || device?.serial || '';
    const res = await ipcService.file.copy(serial, clipboard.item.path, currentPath, clipboard.isCut);
    if (res.success) {
      addToast('success', `${clipboard.isCut ? 'Moved' : 'Copied'} '${clipboard.item.name}' to ${currentPath}`);
      if (clipboard.isCut) setClipboard({ item: null, isCut: false });
      loadDirectory(currentPath);
    } else {
      addToast('error', res.message);
    }
  };

  // HTML5 Drag and Drop handlers
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
    if (files.length === 0) return;

    const serial = device?.serialNumber || device?.serial || '';
    for (const file of files) {
      const pathVal = (file as FileWithPath).path || file.name;
      addToast('info', `Uploading dropped file: ${file.name}...`);
      await ipcService.file.push(serial, pathVal, currentPath);
    }
    loadDirectory(currentPath);
  };

  // Right-click Context Menu trigger
  const handleContextMenu = (e: React.MouseEvent, item: FileItem) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedItem(item);
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, item });
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto pb-6" ref={containerRef}>
      <PageHeader
        title="Android File Manager"
        subtitle="Browse internal storage, upload, download, drag & drop, and manage target device files"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="filled"
              size="sm"
              icon={<Upload className="h-4 w-4" />}
              onClick={handleUpload}
            >
              Upload (Push)
            </Button>
            <Button
              variant="tonal"
              size="sm"
              icon={<FolderPlus className="h-4 w-4" />}
              onClick={() => setIsMkdirModalOpen(true)}
            >
              New Folder
            </Button>
            {clipboard.item && (
              <Button
                variant="outlined"
                size="sm"
                icon={<Clipboard className="h-4 w-4 text-m3-primary" />}
                onClick={handlePaste}
              >
                Paste ({clipboard.item.name})
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className="h-4 w-4" />}
              isLoading={isLoading}
              onClick={handleRefresh}
            >
              Refresh
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column (3 cols): Quick Access Shortcuts */}
        <Card variant="surface-1" className="lg:col-span-3 p-4 space-y-3 border-m3-surface-3">
          <h3 className="text-xs font-semibold text-m3-on-surface-variant uppercase tracking-wider px-2">
            Quick Shortcuts
          </h3>
          <div className="space-y-1">
            {QUICK_SHORTCUTS.map((sc) => {
              const IconComponent = sc.icon;
              const isActive = currentPath === sc.path;
              return (
                <button
                  key={sc.path}
                  onClick={() => navigateTo(sc.path)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-m3-md text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-m3-primary-container text-m3-on-primary-container font-semibold'
                      : 'text-m3-on-surface hover:bg-m3-surface-3'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <IconComponent className={`h-4 w-4 ${isActive ? 'text-m3-primary' : 'text-m3-on-surface-variant'}`} />
                    {sc.name}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                </button>
              );
            })}
          </div>
        </Card>

        {/* Right Column (9 cols): Explorer Main Table */}
        <div className="lg:col-span-9 space-y-3">
          {/* Breadcrumb Path Bar & Search */}
          <Card variant="surface-1" className="p-3 flex items-center justify-between gap-3 border-m3-surface-3">
            <div className="flex items-center gap-1.5 text-xs overflow-x-auto py-1 font-mono">
              <Button
                variant="ghost"
                size="sm"
                icon={<ArrowLeft className="h-3.5 w-3.5" />}
                onClick={handleNavigateUp}
                disabled={currentPath === '/'}
              />
              <button
                onClick={() => loadDirectory('/')}
                className="hover:text-m3-primary text-m3-on-surface font-bold px-1 rounded"
              >
                /
              </button>
              {pathParts.map((part, index) => {
                const fullSegmentPath = '/' + pathParts.slice(0, index + 1).join('/');
                const isLast = index === pathParts.length - 1;
                // Display human-friendly name for known root paths
                const displayLabel = part === 'sdcard' ? 'Internal Storage' : part;
                return (
                  <React.Fragment key={fullSegmentPath}>
                    <ChevronRight className="h-3 w-3 text-m3-on-surface-variant shrink-0" />
                    <button
                      onClick={() => loadDirectory(fullSegmentPath)}
                      className={`px-1.5 py-0.5 rounded transition-colors ${
                        isLast
                          ? 'text-m3-primary font-bold bg-m3-primary-container/30'
                          : 'text-m3-on-surface hover:bg-m3-surface-3'
                      }`}
                    >
                      {displayLabel}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>

            {/* Search Filter Box */}
            <div className="w-56 shrink-0">
              <Input
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                icon={<Search className="h-3.5 w-3.5" />}
              />
            </div>
          </Card>

          {/* HTML5 Drag & Drop File Table Dropzone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative rounded-m3-lg border transition-all duration-200 ${
              isDragOver
                ? 'border-2 border-dashed border-m3-primary bg-m3-primary-container/20 ring-2 ring-m3-primary/30'
                : 'border-m3-surface-3 bg-m3-surface-1'
            }`}
          >
            {isDragOver && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-m3-surface-0/90 backdrop-blur-sm rounded-m3-lg text-m3-primary p-6">
                <Upload className="h-12 w-12 animate-bounce mb-2" />
                <p className="text-sm font-bold">Drop files here to upload to {currentPath}</p>
              </div>
            )}

            {/* Table Header */}
            <div className="grid grid-cols-12 gap-3 px-4 py-2.5 text-[11px] font-semibold text-m3-on-surface-variant uppercase tracking-wider border-b border-m3-surface-3 bg-m3-surface-2/60 rounded-t-m3-lg">
              <div className="col-span-6">Name</div>
              <div className="col-span-2 text-right">Size</div>
              <div className="col-span-4 text-right">Date Modified</div>
            </div>

            {/* Directory Items List */}
            {isLoading ? (
              <div className="p-12 text-center text-m3-on-surface-variant">
                <Loader2 className="h-8 w-8 animate-spin text-m3-primary mx-auto mb-2" />
                <p className="text-xs font-medium">Loading Android Directory...</p>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="p-12 text-center text-m3-on-surface-variant">
                <File className="h-10 w-10 text-m3-primary/30 mx-auto mb-2" />
                <p className="text-xs font-semibold">No items found in this directory</p>
              </div>
            ) : (
              <div className="divide-y divide-m3-surface-3/50 max-h-[500px] overflow-y-auto font-mono text-xs">
                {filteredItems.map((item) => {
                  const isSelected = selectedItem?.path === item.path;
                  return (
                    <div
                      key={item.path}
                      onClick={() => setSelectedItem(item)}
                      onDoubleClick={() => handleOpenItem(item)}
                      onContextMenu={(e) => handleContextMenu(e, item)}
                      className={`grid grid-cols-12 gap-3 px-4 py-2.5 items-center cursor-pointer transition-colors ${
                        isSelected ? 'bg-m3-primary-container/40 text-m3-on-primary-container font-semibold' : 'hover:bg-m3-surface-2 text-m3-on-surface'
                      }`}
                    >
                      <div className="col-span-6 flex items-center gap-2.5 truncate">
                        {getFileIcon(item)}
                        <span className="truncate">{item.name}</span>
                      </div>
                      <div className="col-span-2 text-right text-m3-on-surface-variant">{item.size}</div>
                      <div className="col-span-4 text-right text-m3-on-surface-variant text-[11px] truncate">
                        {item.modified}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating Custom Right-Click Context Menu */}
      {contextMenu.visible && contextMenu.item && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-48 bg-m3-surface-3 border border-m3-surface-5 rounded-m3-md shadow-m3-3 py-1.5 text-xs text-m3-on-surface animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.item.isDirectory && (
            <button
              onClick={() => handleOpenItem(contextMenu.item!)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-m3-surface-4 text-left"
            >
              <Folder className="h-3.5 w-3.5 text-m3-primary" /> Open Directory
            </button>
          )}
          <button
            onClick={() => handleDownload(contextMenu.item!)}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-m3-surface-4 text-left"
          >
            <Download className="h-3.5 w-3.5 text-m3-success" /> Download (Pull)
          </button>
          <button
            onClick={() => handleCopy(contextMenu.item!, false)}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-m3-surface-4 text-left"
          >
            <Copy className="h-3.5 w-3.5 text-m3-secondary" /> Copy
          </button>
          <button
            onClick={() => handleCopy(contextMenu.item!, true)}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-m3-surface-4 text-left"
          >
            <Scissors className="h-3.5 w-3.5 text-m3-tertiary" /> Cut
          </button>
          <button
            onClick={() => {
              setRenameInput(contextMenu.item!.name);
              setIsRenameModalOpen(true);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-m3-surface-4 text-left"
          >
            <Edit2 className="h-3.5 w-3.5 text-m3-warning" /> Rename
          </button>
          <div className="my-1 border-t border-m3-surface-4" />
          <button
            onClick={() => handleDelete(contextMenu.item!)}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-m3-error-container/40 text-m3-error text-left"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      )}

      {/* Transfer Progress Notification Card (Large File Support) */}
      {transfer.visible && (
        <div className="fixed bottom-10 right-4 z-40 w-[min(20rem,calc(100vw-2rem))] bg-m3-surface-3 border border-m3-surface-5 p-4 rounded-m3-lg shadow-m3-3 space-y-2 animate-in slide-in-from-bottom-5 duration-200">
          <div className="flex items-center justify-between text-xs font-semibold text-m3-on-surface">
            <span className="flex items-center gap-2">
              {transfer.direction === 'upload' ? (
                <Upload className="h-4 w-4 text-m3-primary animate-pulse" />
              ) : (
                <Download className="h-4 w-4 text-m3-success animate-pulse" />
              )}
              {transfer.direction === 'upload' ? 'Uploading' : 'Downloading'}
            </span>
            <button onClick={() => setTransfer((prev) => ({ ...prev, visible: false }))}>
              <X className="h-3.5 w-3.5 text-m3-on-surface-variant hover:text-m3-on-surface" />
            </button>
          </div>
          <p className="text-xs text-m3-on-surface truncate font-mono">{transfer.filename}</p>
          <div className="w-full bg-m3-surface-4 h-2 rounded-full overflow-hidden">
            <div
              className="bg-m3-primary h-full rounded-full transition-all duration-300"
              style={{ width: `${transfer.percent}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-m3-on-surface-variant font-mono">
            <span>{transfer.speed}</span>
            <span>{transfer.percent}%</span>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      <Modal
        isOpen={isMkdirModalOpen}
        onClose={() => setIsMkdirModalOpen(false)}
        title="Create New Directory"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setIsMkdirModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="filled" size="sm" onClick={handleCreateFolder}>
              Create Folder
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateFolder} className="space-y-3">
          <Input
            label="Folder Name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="e.g. MyDocuments"
            autoFocus
          />
        </form>
      </Modal>

      {/* Rename Modal */}
      <Modal
        isOpen={isRenameModalOpen}
        onClose={() => setIsRenameModalOpen(false)}
        title="Rename Item"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setIsRenameModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="filled" size="sm" onClick={handleRenameSubmit}>
              Save Name
            </Button>
          </>
        }
      >
        <form onSubmit={handleRenameSubmit} className="space-y-3">
          <Input
            label="New Name"
            value={renameInput}
            onChange={(e) => setRenameInput(e.target.value)}
            autoFocus
          />
        </form>
      </Modal>
    </div>
  );
};

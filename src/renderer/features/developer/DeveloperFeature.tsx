import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Terminal as TerminalIcon,
  FileText,
  SlidersHorizontal,
  Search,
  RefreshCw,
  Trash2,
  Send,
  Database,
  Filter,
} from 'lucide-react';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useAppStore } from '../../store/useAppStore';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Badge } from '../../components/common/Badge';
import { ipcService, LogcatEntry, SystemPropertyItem } from '../../services/ipcService';

type TabType = 'terminal' | 'logcat' | 'properties';

export const DeveloperFeature: React.FC = () => {
  const { getSelectedDevice } = useDeviceStore();
  const { addToast } = useAppStore();
  const device = getSelectedDevice();

  const [activeTab, setActiveTab] = useState<TabType>('terminal');

  // Terminal State
  const [terminalInput, setTerminalInput] = useState<string>('');
  const [terminalHistory, setTerminalHistory] = useState<Array<{ cmd: string; out: string; isErr: boolean }>>([
    { cmd: 'adb devices', out: 'List of devices attached\n28231FDF60032A\tdevice', isErr: false },
  ]);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Logcat & SQLite DB State
  const [logs, setLogs] = useState<LogcatEntry[]>([]);
  const [logSearch, setLogSearch] = useState<string>('');
  const [logLevelFilter, setLogLevelFilter] = useState<string>('ALL');

  // System Properties State
  const [systemProps, setSystemProps] = useState<SystemPropertyItem[]>([]);
  const [propSearch, setPropSearch] = useState<string>('');

  // Fetch Logcat logs
  const loadLogcat = useCallback(async () => {
    const serial = device?.serialNumber || device?.serial || '';
    try {
      const entries = await ipcService.dev.queryLogs(logSearch, logLevelFilter);
      if (entries.length > 0) {
        setLogs(entries);
      } else {
        const fresh = await ipcService.dev.fetchLogcat(serial);
        setLogs(fresh);
      }
    } catch (err: any) {
      addToast('error', `Failed fetching logs: ${err.message}`);
    }
  }, [device, logSearch, logLevelFilter, addToast]);

  // Fetch System Properties
  const loadProperties = useCallback(async () => {
    const serial = device?.serialNumber || device?.serial || '';
    try {
      const props = await ipcService.dev.getSystemProperties(serial);
      setSystemProps(props);
    } catch (err: any) {
      addToast('error', `Failed fetching system properties: ${err.message}`);
    }
  }, [device, addToast]);

  useEffect(() => {
    if (activeTab === 'logcat') loadLogcat();
    if (activeTab === 'properties') loadProperties();
  }, [activeTab, loadLogcat, loadProperties]);

  // Logcat stream timer
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (activeTab === 'logcat') {
      timer = setInterval(() => {
        loadLogcat();
      }, 2500);
    }
    return () => clearInterval(timer);
  }, [activeTab, loadLogcat]);

  // Auto-scroll terminal to bottom
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalHistory]);

  // Feature: Execute Terminal Command
  const handleTerminalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminalInput.trim()) return;

    const cmd = terminalInput.trim();
    setTerminalInput('');

    const serial = device?.serialNumber || device?.serial || '';
    const res = await ipcService.dev.execTerminal(serial, cmd);

    setTerminalHistory((prev) => [
      ...prev,
      {
        cmd,
        out: res.stdout || res.stderr || 'Command executed cleanly.',
        isErr: res.exitCode !== 0 || Boolean(res.stderr && !res.stdout),
      },
    ]);
  };

  // Clear Terminal
  const handleClearTerminal = () => {
    setTerminalHistory([]);
  };

  // Clear Logcat Database
  const handleClearLogcat = async () => {
    await ipcService.dev.clearLogs();
    setLogs([]);
    addToast('info', 'SQLite logcat database cleared.');
  };

  // Filter System Properties
  const filteredProps = systemProps.filter(
    (p) =>
      p.key.toLowerCase().includes(propSearch.toLowerCase()) ||
      p.value.toLowerCase().includes(propSearch.toLowerCase()),
  );

  // Log level color resolver for colored syntax
  const getLogLevelBadge = (level: LogcatEntry['level']) => {
    switch (level) {
      case 'V':
        return <span className="px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 font-mono text-[10px]">VERBOSE</span>;
      case 'D':
        return <span className="px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-300 font-mono text-[10px]">DEBUG</span>;
      case 'I':
        return <span className="px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 font-mono text-[10px]">INFO</span>;
      case 'W':
        return <span className="px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-300 font-mono text-[10px]">WARN</span>;
      case 'E':
        return <span className="px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-300 font-mono text-[10px]">ERROR</span>;
      case 'F':
        return <span className="px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-300 font-mono text-[10px]">FATAL</span>;
      default:
        return <span className="px-1.5 py-0.5 rounded bg-m3-surface-4 text-m3-on-surface font-mono text-[10px]">LOG</span>;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-8">
      <PageHeader
        title="Developer Tools & ADB Terminal"
        subtitle="Interactive ADB shell terminal, SQLite logcat log database, system properties editor, and developer shortcuts"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="filled"
              size="sm"
              icon={<TerminalIcon className="h-4 w-4" />}
              onClick={() => setActiveTab('terminal')}
            >
              ADB Terminal
            </Button>
            <Button
              variant="tonal"
              size="sm"
              icon={<Database className="h-4 w-4" />}
              onClick={() => setActiveTab('logcat')}
            >
              Logcat DB Viewer
            </Button>
          </div>
        }
      />

      {/* Navigation Tabs */}
      <Card variant="surface-1" className="p-2 flex items-center justify-between border-m3-surface-3">
        <div className="flex items-center gap-1.5 text-xs">
          <button
            onClick={() => setActiveTab('terminal')}
            className={`px-3 py-1.5 rounded-m3-md font-medium flex items-center gap-2 transition-colors ${
              activeTab === 'terminal'
                ? 'bg-m3-primary text-m3-on-primary font-semibold shadow-m3-1'
                : 'text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            <TerminalIcon className="h-4 w-4" /> ADB Terminal Shell
          </button>
          <button
            onClick={() => setActiveTab('logcat')}
            className={`px-3 py-1.5 rounded-m3-md font-medium flex items-center gap-2 transition-colors ${
              activeTab === 'logcat'
                ? 'bg-m3-primary text-m3-on-primary font-semibold shadow-m3-1'
                : 'text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            <FileText className="h-4 w-4" /> Logcat DB Stream
          </button>
          <button
            onClick={() => setActiveTab('properties')}
            className={`px-3 py-1.5 rounded-m3-md font-medium flex items-center gap-2 transition-colors ${
              activeTab === 'properties'
                ? 'bg-m3-primary text-m3-on-primary font-semibold shadow-m3-1'
                : 'text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" /> System Properties (getprop)
          </button>
        </div>

        <Badge variant="primary" className="font-mono text-xs hidden sm:flex">
          SERIAL: {device?.serialNumber || device?.serial || 'DISCONNECTED'}
        </Badge>
      </Card>

      {/* TAB 1: Interactive ADB Terminal Console */}
      {activeTab === 'terminal' && (
        <Card variant="surface-2" className="p-4 space-y-4 border-m3-surface-4 bg-[#0A0D14] shadow-m3-3">
          <div className="flex items-center justify-between border-b border-m3-surface-4 pb-2 text-xs font-mono">
            <span className="text-m3-primary font-semibold flex items-center gap-2">
              <TerminalIcon className="h-4 w-4 text-m3-primary" /> ADB Shell Interactive Console
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 className="h-3.5 w-3.5 text-m3-on-surface-variant" />}
              onClick={handleClearTerminal}
            >
              Clear Screen
            </Button>
          </div>

          {/* Terminal Output Window with Colored Syntax */}
          <div className="font-mono text-xs space-y-3 min-h-[380px] max-h-[500px] overflow-y-auto p-3 bg-black/80 rounded-m3-md border border-m3-surface-5/60 select-text">
            {terminalHistory.map((item, idx) => (
              <div key={idx} className="space-y-1">
                <div className="text-m3-primary flex items-center gap-1.5 font-bold">
                  <span className="text-m3-success">$</span> {item.cmd}
                </div>
                <pre className={`whitespace-pre-wrap pl-3 font-mono text-[11px] ${item.isErr ? 'text-m3-error' : 'text-m3-on-surface-variant/90'}`}>
                  {item.out}
                </pre>
              </div>
            ))}
            <div ref={terminalEndRef} />
          </div>

          {/* Terminal Prompt Form Input */}
          <form onSubmit={handleTerminalSubmit} className="flex items-center gap-2 pt-1">
            <span className="font-mono text-m3-success font-bold text-sm">$ adb shell</span>
            <input
              type="text"
              value={terminalInput}
              onChange={(e) => setTerminalInput(e.target.value)}
              placeholder="e.g. pm list packages, dumpsys battery, getprop..."
              className="flex-1 bg-m3-surface-2 border border-m3-surface-4 rounded-m3-md px-3 py-2 text-xs font-mono text-m3-on-surface focus:outline-none focus:ring-1 focus:ring-m3-primary"
            />
            <Button variant="filled" size="sm" icon={<Send className="h-3.5 w-3.5" />}>
              Exec
            </Button>
          </form>
        </Card>
      )}

      {/* TAB 2: Logcat Viewer & SQLite Log Database */}
      {activeTab === 'logcat' && (
        <div className="space-y-4">
          <Card variant="surface-1" className="p-3 flex flex-col md:flex-row items-center justify-between gap-3 border-m3-surface-3">
            {/* Filter Buttons */}
            <div className="flex items-center gap-1 text-xs">
              <span className="text-m3-on-surface-variant mr-1 font-semibold flex items-center gap-1">
                <Filter className="h-3.5 w-3.5" /> Level:
              </span>
              {['ALL', 'V', 'D', 'I', 'W', 'E', 'F'].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setLogLevelFilter(lvl)}
                  className={`px-2.5 py-1 rounded font-mono transition-colors ${
                    logLevelFilter === lvl
                      ? 'bg-m3-primary text-m3-on-primary font-bold'
                      : 'bg-m3-surface-2 text-m3-on-surface-variant hover:text-m3-on-surface'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>

            {/* Search & Actions */}
            <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="w-full md:w-64">
                <Input
                  placeholder="Search tag, PID, or message..."
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  icon={<Search className="h-3.5 w-3.5" />}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={handleClearLogcat}
                title="Clear Database Logs"
              />
            </div>
          </Card>

          {/* Colored Syntax Logcat Table */}
          <Card variant="surface-2" className="p-0 overflow-hidden border-m3-surface-4">
            <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[11px] font-semibold text-m3-on-surface-variant uppercase tracking-wider bg-m3-surface-3 border-b border-m3-surface-4">
              <div className="col-span-2">Time</div>
              <div className="col-span-1">Level</div>
              <div className="col-span-2">Tag (PID)</div>
              <div className="col-span-7">Log Message</div>
            </div>

            <div className="divide-y divide-m3-surface-4/60 max-h-[500px] overflow-y-auto font-mono text-xs bg-m3-surface-1">
              {logs.length === 0 ? (
                <div className="p-8 text-center text-m3-on-surface-variant">
                  No logcat entries match current filter criteria.
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="grid grid-cols-12 gap-2 px-4 py-2 items-start hover:bg-m3-surface-2/60">
                    <div className="col-span-2 text-m3-on-surface-variant/80 text-[11px] truncate">
                      {log.timestamp}
                    </div>
                    <div className="col-span-1">{getLogLevelBadge(log.level)}</div>
                    <div className="col-span-2 text-m3-primary font-bold text-[11px] truncate">
                      {log.tag} <span className="text-m3-on-surface-variant/60">({log.pid})</span>
                    </div>
                    <div className="col-span-7 text-m3-on-surface whitespace-pre-wrap break-words leading-relaxed text-[11px]">
                      {log.message}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {/* TAB 3: System Properties (getprop / setprop) */}
      {activeTab === 'properties' && (
        <div className="space-y-4">
          <Card variant="surface-1" className="p-3 flex items-center justify-between gap-3 border-m3-surface-3">
            <div className="w-72">
              <Input
                placeholder="Filter property key or value..."
                value={propSearch}
                onChange={(e) => setPropSearch(e.target.value)}
                icon={<Search className="h-3.5 w-3.5" />}
              />
            </div>
            <Button
              variant="outlined"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={loadProperties}
            >
              Refresh Properties
            </Button>
          </Card>

          <Card variant="surface-2" className="p-0 overflow-hidden border-m3-surface-4">
            <div className="grid grid-cols-12 gap-3 px-4 py-2 text-[11px] font-semibold text-m3-on-surface-variant uppercase tracking-wider bg-m3-surface-3 border-b border-m3-surface-4">
              <div className="col-span-5">Property Key</div>
              <div className="col-span-7">Value</div>
            </div>

            <div className="divide-y divide-m3-surface-4/60 max-h-[500px] overflow-y-auto font-mono text-xs bg-m3-surface-1">
              {filteredProps.map((prop) => (
                <div key={prop.key} className="grid grid-cols-12 gap-3 px-4 py-2 items-center hover:bg-m3-surface-2">
                  <div className="col-span-5 text-m3-primary font-semibold truncate">{prop.key}</div>
                  <div className="col-span-7 text-m3-on-surface truncate" title={prop.value}>
                    {prop.value || '<empty>'}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

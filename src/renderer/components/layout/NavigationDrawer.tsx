import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Smartphone,
  FolderOpen,
  AppWindow,
  MonitorPlay,
  SlidersHorizontal,
  Terminal,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { cn } from '../../utils/cn';
import { Tooltip } from '../common/Tooltip';

export interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
}

export const navItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
  { path: '/devices', label: 'Devices', icon: <Smartphone className="h-5 w-5" /> },
  { path: '/files', label: 'File Manager', icon: <FolderOpen className="h-5 w-5" /> },
  { path: '/apps', label: 'Apps', icon: <AppWindow className="h-5 w-5" /> },
  { path: '/screen', label: 'Screen Mirror', icon: <MonitorPlay className="h-5 w-5" /> },
  { path: '/control', label: 'Device Control', icon: <SlidersHorizontal className="h-5 w-5" /> },
  { path: '/developer', label: 'Developer', icon: <Terminal className="h-5 w-5" /> },
  { path: '/settings', label: 'Settings', icon: <Settings className="h-5 w-5" /> },
];

export const NavigationDrawer: React.FC = () => {
  const { isSidebarCollapsed, toggleSidebar } = useAppStore();
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const isCollapsed = isSidebarCollapsed || isCompactViewport;

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1100px)');
    const update = () => setIsCompactViewport(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  return (
    <aside
      className={cn(
        'relative min-h-0 bg-m3-surface-1 border-r border-m3-surface-3 flex flex-col justify-between overflow-hidden transition-[width] duration-200 z-20 select-none shrink-0',
        isCollapsed ? 'w-16' : 'w-64',
      )}
      aria-label="Primary navigation"
    >
      {/* Brand Header */}
      <div className={cn("h-16 flex items-center border-b border-m3-surface-3 shrink-0 transition-all", isCollapsed ? "justify-center px-0" : "justify-between px-4")}>
        <div className={cn("flex items-center gap-3 min-w-0 overflow-hidden transition-opacity", isCollapsed ? "opacity-0 hidden" : "opacity-100")}>
          <div className="p-2 rounded-m3-md bg-m3-primary-container text-m3-on-primary-container shrink-0">
            <Zap className="h-5 w-5 text-m3-primary" />
          </div>
          <div className="flex flex-col min-w-0 truncate">
            <span className="text-sm font-bold text-m3-on-surface tracking-wide truncate">
              Android Control
            </span>
            <span className="text-[10px] font-semibold tracking-wider text-m3-primary uppercase truncate">
              Center Shell
            </span>
          </div>
        </div>
        {!isCompactViewport && (
          <button
            onClick={toggleSidebar}
            className={cn(
              "p-1.5 rounded-m3-sm text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-3 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-m3-primary",
              isCollapsed && "mx-auto"
            )}
            title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            aria-label={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Navigation List */}
      <nav className="flex-1 py-3 px-2 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const content = (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-m3-md font-medium text-sm transition-all duration-200 group relative',
                  isActive
                    ? 'bg-m3-primary-container text-m3-on-primary-container shadow-m3-1'
                    : 'text-m3-on-surface-variant hover:bg-m3-surface-3 hover:text-m3-on-surface',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn('shrink-0 transition-colors', isActive ? 'text-m3-primary' : 'text-m3-on-surface-variant group-hover:text-m3-on-surface')}>
                    {item.icon}
                  </span>
                  {!isCollapsed && <span className="min-w-0 truncate">{item.label}</span>}
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-m3-primary rounded-r-full" />
                  )}
                </>
              )}
            </NavLink>
          );

          return isCollapsed ? (
            <Tooltip key={item.path} content={item.label} position="right">
              {content}
            </Tooltip>
          ) : (
            content
          );
        })}
      </nav>

      {/* Footer Version Info */}
      <div className="p-3 border-t border-m3-surface-3 text-center">
        {!isCollapsed ? (
          <div className="flex items-center justify-between text-[11px] text-m3-on-surface-variant/70">
            <span>ADB Shell</span>
            <span className="px-1.5 py-0.5 rounded bg-m3-surface-3 text-[10px] font-mono text-m3-primary">Beta</span>
          </div>
        ) : (
          <span className="text-[10px] font-mono text-m3-primary">Beta</span>
        )}
      </div>
    </aside>
  );
};

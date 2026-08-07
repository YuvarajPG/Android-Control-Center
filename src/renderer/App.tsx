import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { DevicesPage } from './pages/DevicesPage';
import { FileManagerPage } from './pages/FileManagerPage';
import { AppsPage } from './pages/AppsPage';
import { ScreenPage } from './pages/ScreenPage';
import { DeviceControlPage } from './pages/DeviceControlPage';
import { DeveloperPage } from './pages/DeveloperPage';
import { SettingsPage } from './pages/SettingsPage';

// HashRouter is safest for Electron file:// environment
export const App: React.FC = () => {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="devices" element={<DevicesPage />} />
          <Route path="files" element={<FileManagerPage />} />
          <Route path="apps" element={<AppsPage />} />
          <Route path="screen" element={<ScreenPage />} />
          <Route path="control" element={<DeviceControlPage />} />
          <Route path="developer" element={<DeveloperPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
};

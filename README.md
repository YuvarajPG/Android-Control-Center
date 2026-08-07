# 📱 Android Control Center

> A commercial-grade, ultra-high-performance desktop application for managing, mirroring, and controlling Android devices wirelessly and via USB. Built with Electron, React, TypeScript, Vite, TailwindCSS (Material Design 3 Dark Theme), and Scrcpy Engine.

---

## 🔥 Key Features

- ⚡ **ADB Core Service**: Auto-installer for Windows platform tools, Linux package manager detection, structured JSON output.
- 🚀 **Full Automation Engine**: Automatic USB & Wi-Fi device discovery, IP change auto-detection, auto-reconnect on launch, self-healing ADB server auto-restart, and recovery after device reboot.
- 📊 **Material Design 3 Dashboard**: Real-time telemetry cards for AMOLED mockup, Battery, Charging, CPU, RAM, Storage, Temp, Network RSSI, IP, ADB Status, Dev Mode, and Wireless Debugging.
- 📁 **File Explorer**: Quick access shortcuts (`/sdcard`, `Download`, `DCIM`, etc.), Upload (push), Download (pull), Delete, Rename, Copy/Cut/Paste, Create Folder, HTML5 Drag & Drop, Context Menu, and transfer progress bar.
- 📦 **App Manager**: Installed app list filtering (User/System), Search, Launch, Force Stop, Install APK (picker & Drag & Drop), Uninstall, Backup/Export APK, Clear Cache/Data, and Permission Inspector.
- 🎛️ **Hardware Control**: Volume, Screen Brightness slider, Torch/Flashlight toggle, Lock, Wake, Auto-Rotate & orientation angles, Android Clipboard Sync, Media Controls, Restart SystemUI (Root), Reboot options (System/Recovery/Bootloader), and Power Off.
- 📹 **Live Screen Mirror & Recorder**: Low-latency live stream canvas, preset quality modes (720p 30fps, 1080p 60fps, 1440p 60fps), Fullscreen mode, Screencap PNG screenshot capture, Screenrecord MP4 video recording, and Clipboard OCR.
- 💻 **Developer Tools & ADB Terminal**: Monospace ADB shell prompt console, Logcat table with colored log level badges, SQLite logcat database storage, and System Properties editor (`getprop` / `setprop`).
- 🧙 **First-Run Setup Wizard**: 6-step zero-configuration onboarding setup wizard.
- ⌨️ **Accessibility & Shortcuts**: Global keyboard shortcuts (`Ctrl+1..8`, `Ctrl+R`), Error Boundaries, Skeleton loading state placeholders, and Native OS Notifications.

---

## 🛠️ Installation & Development Setup

### Prerequisites
- Node.js `v18.0.0+`
- `pnpm` Package Manager (`npm i -g pnpm`)

### Installation Commands

```bash
# Clone the repository
git clone https://github.com/your-username/android-control-center.git
cd "android-control-center"

# Install dependencies
pnpm install

# Run application in development mode
pnpm run dev

# Run TypeScript type check
pnpm run typecheck

# Build standalone electron production binary
pnpm run build:dir
```

---

## 🎹 Global Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + 1` | Navigate to **Dashboard** |
| `Ctrl + 2` | Navigate to **Device Manager** |
| `Ctrl + 3` | Navigate to **File Explorer** |
| `Ctrl + 4` | Navigate to **App Manager** |
| `Ctrl + 5` | Navigate to **Screen Mirroring** |
| `Ctrl + 6` | Navigate to **Hardware Control** |
| `Ctrl + 7` | Navigate to **Developer Tools** |
| `Ctrl + 8` | Navigate to **Settings** |
| `Ctrl + R` | **Rescan ADB Bus** |
| `Escape` | Close active modal dialog |

---

## 📄 License
MIT License. Created by the Advanced Agentic Coding Team.

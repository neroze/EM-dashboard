import { createApp } from './bridge.js';
import * as appMod from './src/main.js';

const FRONTEND = "http://127.0.0.1:5173";
const RESOURCES = "/Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/resources";
const EXECUTABLES = null;

const app = await createApp({
  htmlPath: FRONTEND,
  title: "Leave Radar",
  size: "1280x820",
  version: "0.1.0",
  tinyjsVersion: "v0.57.0",
  id: "com.example.leave-radar",
  resourcesPath: RESOURCES,
  executablesPath: EXECUTABLES,
  api: appMod.api ?? {},
  onMenu: appMod.onMenu,
  onTray: appMod.onTray,
  onHotkey: appMod.onHotkey,
  onContextMenu: appMod.onContextMenu,
  onSystem: appMod.onSystem,
  onOpenUrl: appMod.onOpenUrl,
  onOpenFiles: appMod.onOpenFiles,
  onNotificationClick: appMod.onNotificationClick,
  onNotificationAction: appMod.onNotificationAction,
  onMediaKey: appMod.onMediaKey,
  onWindowClosed: appMod.onWindowClosed,
  onWindowState: appMod.onWindowState,
  onClipboardChange: appMod.onClipboardChange,
  onUpdateAvailable: appMod.onUpdateAvailable,
  onAudioTap: appMod.onAudioTap,
  onLocale: appMod.onLocale,
  onNavigate: appMod.onNavigate,
  onDownload: appMod.onDownload,
  onWindowOpen: appMod.onWindowOpen,
  url: null,
  downloads: null,
  popups: null,
  apiAccess: null,
  inject: null,
  chrome: null,
  update: null,
  activation: null,
  mainWindow: true,
  readAccess: null,
  userAgent: null,
  audioTap: null,
  windowPlacement: null,
  contextMenu: false,
  browserAccelerators: false,
  debug: false,
  about: null,
  urlScheme: null,
  fileExtensions: null,
  openFolders: false,
  permissions: null,
  offscreenRescue: null,
});
if (appMod.init) appMod.init(app);

await app.done;
tjs.exit(0);

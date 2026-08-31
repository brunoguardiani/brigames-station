import { ipcMain, IpcMainInvokeEvent } from 'electron';

import { DesktopUpdaterService } from './updater.service';
import { DESKTOP_UPDATER_CHANNELS, DesktopUpdaterStatus } from './updater.types';

export type TrustedRendererURL = (url: string) => boolean;

function assertTrustedSender(event: IpcMainInvokeEvent, isTrustedRendererURL: TrustedRendererURL): void {
  const senderFrame = event.senderFrame;
  if (senderFrame !== event.sender.mainFrame || !isTrustedRendererURL(senderFrame.url)) {
    throw new Error('Untrusted desktop updater request.');
  }
}

/** Registers the narrow updater IPC surface and returns a cleanup function. */
export function registerDesktopUpdaterIPC(
  updater: DesktopUpdaterService,
  isTrustedRendererURL: TrustedRendererURL,
): () => void {
  ipcMain.handle(
    DESKTOP_UPDATER_CHANNELS.getStatus,
    (event): DesktopUpdaterStatus => {
      assertTrustedSender(event, isTrustedRendererURL);
      return updater.getStatus();
    },
  );

  ipcMain.handle(
    DESKTOP_UPDATER_CHANNELS.checkForUpdates,
    async (event): Promise<DesktopUpdaterStatus> => {
      assertTrustedSender(event, isTrustedRendererURL);
      return updater.checkForUpdates('manual');
    },
  );

  ipcMain.handle(
    DESKTOP_UPDATER_CHANNELS.installUpdate,
    (event): boolean => {
      assertTrustedSender(event, isTrustedRendererURL);
      return updater.installDownloadedUpdate();
    },
  );

  return () => {
    ipcMain.removeHandler(DESKTOP_UPDATER_CHANNELS.getStatus);
    ipcMain.removeHandler(DESKTOP_UPDATER_CHANNELS.checkForUpdates);
    ipcMain.removeHandler(DESKTOP_UPDATER_CHANNELS.installUpdate);
  };
}

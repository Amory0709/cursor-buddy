import { contextBridge, ipcRenderer } from 'electron';
import type { BuddyEnvelope, DesktopCommandPayload } from '@cursor-buddy/protocol';

export interface CursorBuddyRendererApi {
  onEvent(listener: (envelope: BuddyEnvelope) => void): () => void;
  sendCommand(payload: DesktopCommandPayload): void;
  notifyBreak(message: string): void;
}

const api: CursorBuddyRendererApi = {
  onEvent(listener) {
    const channelListener = (_event: Electron.IpcRendererEvent, envelope: BuddyEnvelope): void => {
      listener(envelope);
    };

    ipcRenderer.on('buddy:event', channelListener);

    return () => {
      ipcRenderer.off('buddy:event', channelListener);
    };
  },
  sendCommand(payload) {
    ipcRenderer.send('buddy:command', payload);
  },
  notifyBreak(message) {
    ipcRenderer.send('buddy:notify-break', message);
  },
};

contextBridge.exposeInMainWorld('cursorBuddy', api);

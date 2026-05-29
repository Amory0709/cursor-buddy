export const BUDDY_PROTOCOL_VERSION = 1 as const;

export type BuddyMessageSource = 'cursor-extension' | 'desktop-assistant';

export type CursorActivityReason =
  | 'startup'
  | 'manual'
  | 'timer'
  | 'editor-change'
  | 'document-change'
  | 'document-save'
  | 'window-focus';

export interface CursorActivitySnapshot {
  readonly workspaceName: string;
  readonly workspacePath: string | null;
  readonly activeFile: string | null;
  readonly gitBranch: string | null;
  readonly windowFocused: boolean;
  readonly lastActivityAt: number;
  readonly idleSeconds: number;
  readonly editsSinceStart: number;
  readonly savesSinceStart: number;
  readonly changedFiles: readonly string[];
  readonly reason: CursorActivityReason;
}

export interface FocusSessionSettings {
  readonly focusMinutes: number;
  readonly breakMinutes: number;
  readonly autoStart: boolean;
}

export interface DesktopCommandPayload {
  readonly command:
    | 'copyPrompt'
    | 'openWorkspace'
    | 'startFocus'
    | 'pauseFocus'
    | 'resumeFocus'
    | 'switchScenario';
  readonly data?: Record<string, unknown>;
}

export interface LifecyclePayload {
  readonly event: 'ready' | 'closing' | 'error';
  readonly detail?: string;
}

export type BuddyMessageType =
  | 'cursor.snapshot'
  | 'cursor.settings'
  | 'desktop.command'
  | 'lifecycle';

export interface BuddyEnvelope<TPayload = unknown> {
  readonly protocolVersion: typeof BUDDY_PROTOCOL_VERSION;
  readonly id: string;
  readonly timestamp: number;
  readonly source: BuddyMessageSource;
  readonly type: BuddyMessageType;
  readonly payload: TPayload;
}

export function createBuddyEnvelope<TPayload>(
  source: BuddyMessageSource,
  type: BuddyMessageType,
  payload: TPayload,
): BuddyEnvelope<TPayload> {
  return {
    protocolVersion: BUDDY_PROTOCOL_VERSION,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: Date.now(),
    source,
    type,
    payload,
  };
}

export function isBuddyEnvelope(value: unknown): value is BuddyEnvelope {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.protocolVersion === BUDDY_PROTOCOL_VERSION &&
    typeof value.id === 'string' &&
    typeof value.timestamp === 'number' &&
    (value.source === 'cursor-extension' || value.source === 'desktop-assistant') &&
    typeof value.type === 'string' &&
    'payload' in value
  );
}

export function isDesktopCommandPayload(value: unknown): value is DesktopCommandPayload {
  if (!isRecord(value) || typeof value.command !== 'string') {
    return false;
  }

  return [
    'copyPrompt',
    'openWorkspace',
    'startFocus',
    'pauseFocus',
    'resumeFocus',
    'switchScenario',
  ].includes(value.command);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

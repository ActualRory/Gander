import type { Message } from './message.js'

// Events sent from server → client
export type ServerEvent =
  | { type: 'message:new'; payload: Message }
  | { type: 'message:edited'; payload: Message }
  | { type: 'message:deleted'; payload: { id: string; channelId: string } }
  | { type: 'presence:join'; payload: { userId: string; channelId: string } }
  | { type: 'presence:leave'; payload: { userId: string; channelId: string } }
  | { type: 'voice:join'; payload: { userId: string; channelId: string } }
  | { type: 'voice:leave'; payload: { userId: string; channelId: string } }
  | { type: 'users:init'; payload: { onlineUserIds: string[] } }
  | { type: 'user:online'; payload: { userId: string } }
  | { type: 'user:offline'; payload: { userId: string; lastSeenAt: string } }
  | { type: 'voice:init'; payload: { voiceRooms: Record<string, string[]> } }

// Events sent from client → server
export type ClientEvent =
  | { type: 'message:send'; payload: { channelId: string; content: string } }
  | { type: 'channel:join'; payload: { channelId: string } }
  | { type: 'channel:leave'; payload: { channelId: string } }
  | { type: 'voice:join'; payload: { channelId: string } }
  | { type: 'voice:leave'; payload: { channelId: string } }

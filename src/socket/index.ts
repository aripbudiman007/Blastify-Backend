import { Server as SocketIOServer } from 'socket.io';

let _io: SocketIOServer | null = null;

export function setIO(io: SocketIOServer): void {
  _io = io;
}

export function getIO(): SocketIOServer | null {
  return _io;
}

/** Emit to a device room — safe no-op if Socket.IO not ready */
export function emitToDevice(deviceId: string, event: string, data: object): void {
  _io?.to(`device:${deviceId}`).emit(event, data);
}

/** Emit to a user room (all devices/tabs of one user) */
export function emitToUser(userId: string, event: string, data: object): void {
  _io?.to(`user:${userId}`).emit(event, data);
}

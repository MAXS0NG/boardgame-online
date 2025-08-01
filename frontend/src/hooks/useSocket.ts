// frontend/src/hooks/useSocket.ts
import { io } from 'socket.io-client'

let socket: any
export function getSocket() {
  if (socket) return socket
  const URL =
    import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001' // ← 로컬 대체
  socket = io(URL, { transports: ['websocket'], autoConnect: true })
  return socket
}

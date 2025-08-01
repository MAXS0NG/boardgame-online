import React, { useEffect, useState } from 'react'
import Lobby from './components/Lobby'
import GameBoard from './components/GameBoard'
import { getSocket } from './hooks/useSocket'

export default function App() {
  const [connected, setConnected] = useState(false)
  const [playerId] = useState(() => {
    const k = 'playerId'
    const v = localStorage.getItem(k)
    if (v) return v
    const n = crypto.randomUUID()
    localStorage.setItem(k, n)
    return n
  })
  const [state, setState] = useState<any>(null)

  useEffect(() => {
    const s = getSocket()
    s.on('connect', () => setConnected(true))
    s.on('state', (game) => setState(game))
    s.on('error', (msg) => alert(msg))
    return () => {
      s.off('connect')
      s.off('state')
      s.off('error')
    }
  }, [])

  if (!connected) return <div className="p-6">서버 연결 중…</div>
  if (!state) return <Lobby playerId={playerId} />

  return <GameBoard state={state} playerId={playerId} />
}

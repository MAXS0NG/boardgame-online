import React, { useState } from 'react'
import { getSocket } from '../hooks/useSocket'

export default function Lobby({ playerId }: { playerId: string }) {
  const s = getSocket()
  const [nickname, setNickname] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [created, setCreated] = useState<string | null>(null)

  const create = () => {
    if (!nickname) return alert('닉네임을 입력하세요.')
    s.emit('createRoom', nickname, playerId, (code: string) => {
      setCreated(code)
    })
  }

  const join = () => {
    if (!nickname || !roomCode) return alert('닉네임과 방 코드를 입력하세요.')
    s.emit('joinRoom', roomCode, nickname, playerId, (ok: boolean, msg?: string) => {
      if (!ok) return alert(msg || '입장 실패')
    })
  }

  return (
    <div className="p-6 max-w-md mx-auto space-y-4">
      <h1 className="text-2xl font-bold">보드게임 로비</h1>
      <label className="block">
        <span className="text-sm text-gray-300">닉네임</span>
        <input className="mt-1 w-full px-3 py-2 bg-gray-800 rounded" value={nickname} onChange={e=>setNickname(e.target.value)} />
      </label>

      <div className="flex gap-2">
        <button className="px-4 py-2 bg-blue-600 rounded" onClick={create}>방 만들기</button>
        {created && <span className="px-2">코드: <b>{created}</b></span>}
      </div>

      <div className="border-t border-gray-700 pt-4">
        <label className="block">
          <span className="text-sm text-gray-300">방 코드</span>
          <input className="mt-1 w-full px-3 py-2 bg-gray-800 rounded" value={roomCode} onChange={e=>setRoomCode(e.target.value)} />
        </label>
        <button className="mt-2 px-4 py-2 bg-green-600 rounded" onClick={join}>입장</button>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { Circle, Group, Layer, Rect, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { onDisconnect, onValue, ref, remove, set, update } from 'firebase/database'

import { defaultBoardId } from '../config/env'
import { db, rtdb } from '../firebase/client'
import { stableColor } from '../lib/color'
import { useAuth } from '../state/AuthContext'
import type { BoardObject, CursorPresence, Point } from '../types/board'
import { AICommandPanel } from '../components/AICommandPanel'

type Viewport = {
  x: number
  y: number
  scale: number
}

const BOARD_HEADER_HEIGHT = 76
const aiApiBaseUrl = (import.meta.env.VITE_AI_API_BASE_URL || '').replace(/\/$/, '')
const aiCommandEndpoint = `${aiApiBaseUrl}/api/ai/command`

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const BoardPage = () => {
  const { boardId: boardIdParam } = useParams()
  const { user, signOutUser } = useAuth()

  const boardId = boardIdParam || defaultBoardId

  const [objects, setObjects] = useState<BoardObject[]>([])
  const objectsRef = useRef<BoardObject[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [clipboardObject, setClipboardObject] = useState<BoardObject | null>(null)
  const [draggingObjectId, setDraggingObjectId] = useState<string | null>(null)
  const [localObjectPositions, setlocalObjectPositions] = useState<Record<string, Point>>({})

  const [cursors, setCursors] = useState<Record<string, CursorPresence>>({})

  const stageRef = useRef<Konva.Stage | null>(null)
  const [stageSize, setStageSize] = useState({
    width: window.innerWidth,
    height: Math.max(320, window.innerHeight - BOARD_HEADER_HEIGHT),
  })
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 })

  const presenceRef = useRef<ReturnType<typeof ref> | null>(null)
  const lastCursorPublishAtRef = useRef(0)

  const dragPublishersRef = useRef<Record<string, (point: Point) => void>>({})

  useEffect(() => {
    const handleResize = () => {
      setStageSize({
        width: window.innerWidth,
        height: Math.max(320, window.innerHeight - BOARD_HEADER_HEIGHT),
      })
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!db) return

    const objectsCollection = collection(db, 'boards', boardId, 'objects')
    const unsubscribe = onSnapshot(objectsCollection, (snapshot) => {
      const nextObjects: BoardObject[] = []

      snapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data() as Partial<BoardObject>

        if (!data.id || !data.type || !data.position || !data.size || data.deleted) {
          return
        }

        nextObjects.push(data as BoardObject)
      })

      nextObjects.sort((left, right) => left.zIndex - right.zIndex)
      objectsRef.current = nextObjects

      // Don't update objects state if we're currently dragging one of them
      setObjects((prevObjects) => {
        if (draggingObjectId) {
          return nextObjects.map((obj) =>
            obj.id === draggingObjectId
              ? prevObjects.find((o) => o.id === draggingObjectId) || obj
              : obj
          )
        }
        return nextObjects
      })
    })

    return unsubscribe
  }, [boardId, draggingObjectId])

  useEffect(() => {
    if (!rtdb) return

    const boardPresenceRef = ref(rtdb, `presence/${boardId}`)
    const unsubscribe = onValue(boardPresenceRef, (snapshot) => {
      const next = snapshot.val() as Record<string, CursorPresence> | null
      setCursors(next || {})
    })

    return () => unsubscribe()
  }, [boardId])

  useEffect(() => {
    if (!rtdb || !user) {
      return
    }

    const userPresenceRef = ref(rtdb, `presence/${boardId}/${user.uid}`)
    presenceRef.current = userPresenceRef

    void set(userPresenceRef, {
      boardId,
      userId: user.uid,
      displayName: user.displayName || user.email || 'Anonymous',
      color: stableColor(user.uid),
      x: 0,
      y: 0,
      lastSeen: Date.now(),
      connectionId: crypto.randomUUID(),
    } satisfies CursorPresence)

    const disconnectHandler = onDisconnect(userPresenceRef)
    void disconnectHandler.remove()

    return () => {
      presenceRef.current = null
      void remove(userPresenceRef)
    }
  }, [boardId, user])

  useEffect(() => {
    if (!presenceRef.current) {
      return
    }

    const heartbeat = window.setInterval(() => {
      if (!presenceRef.current) {
        return
      }
      void update(presenceRef.current, { lastSeen: Date.now() })
    }, 10_000)

    return () => window.clearInterval(heartbeat)
  }, [boardId, user])

  const selectedObject = useMemo(
    () => objects.find((boardObject) => boardObject.id === selectedId) || null,
    [objects, selectedId],
  )

  const createObject = useCallback(
    async (objectType: 'stickyNote' | 'shape') => {
      if (!db || !user) {
        return
      }

      const id = crypto.randomUUID()
      const now = Date.now()
      const currentZIndex = objectsRef.current.reduce(
        (maxValue, boardObject) => Math.max(maxValue, boardObject.zIndex),
        0,
      )

      const centerPosition = {
        x: (-viewport.x + stageSize.width / 2) / viewport.scale,
        y: (-viewport.y + stageSize.height / 2) / viewport.scale,
      }

      const base = {
        id,
        boardId,
        position: centerPosition,
        size: { width: 180, height: 110 },
        zIndex: currentZIndex + 1,
        createdBy: user.uid,
        createdAt: now,
        updatedBy: user.uid,
        updatedAt: now,
        version: 1,
      }

      const nextObject: BoardObject =
        objectType === 'stickyNote'
          ? {
              ...base,
              type: 'stickyNote',
              color: '#fde68a',
              text: 'New sticky note',
            }
          : {
              ...base,
              type: 'shape',
              shapeType: 'rectangle',
              color: '#93c5fd',
            }

      await setDoc(doc(db, 'boards', boardId, 'objects', id), nextObject)
      setSelectedId(id)
    },
    [boardId, stageSize.height, stageSize.width, user, viewport.scale, viewport.x, viewport.y],
  )

  const patchObject = useCallback(
    async (objectId: string, patch: Partial<BoardObject>) => {
      if (!db || !user) {
        return
      }

      const currentObject = objectsRef.current.find((boardObject) => boardObject.id === objectId)
      if (!currentObject) {
        return
      }

      await setDoc(
        doc(db, 'boards', boardId, 'objects', objectId),
        {
          ...patch,
          updatedAt: Date.now(),
          updatedBy: user.uid,
          version: currentObject.version + 1,
        },
        { merge: true },
      )
    },
    [boardId, user],
  )

  const deleteSelected = useCallback(async () => {
    if (!db || !selectedObject) {
      return
    }

    await deleteDoc(doc(db, 'boards', boardId, 'objects', selectedObject.id))
    setSelectedId(null)
  }, [boardId, selectedObject])

  const duplicateObject = useCallback(
    async (source: BoardObject) => {
      if (!db || !user) {
        return
      }

      const id = crypto.randomUUID()
      const now = Date.now()
      const zIndex = objectsRef.current.reduce(
        (maxValue, boardObject) => Math.max(maxValue, boardObject.zIndex),
        0,
      )

      const duplicate: BoardObject = {
        ...source,
        id,
        position: {
          x: source.position.x + 24,
          y: source.position.y + 24,
        },
        zIndex: zIndex + 1,
        createdBy: user.uid,
        updatedBy: user.uid,
        createdAt: now,
        updatedAt: now,
        version: 1,
      }

      await setDoc(doc(db, 'boards', boardId, 'objects', id), duplicate)
      setSelectedId(id)
    },
    [boardId, user],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return
      }

      const isMetaCombo = event.metaKey || event.ctrlKey

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedObject) {
        event.preventDefault()
        void deleteSelected()
        return
      }

      if (isMetaCombo && event.key.toLowerCase() === 'd' && selectedObject) {
        event.preventDefault()
        void duplicateObject(selectedObject)
        return
      }

      if (isMetaCombo && event.key.toLowerCase() === 'c' && selectedObject) {
        event.preventDefault()
        setClipboardObject(selectedObject)
        return
      }

      if (isMetaCombo && event.key.toLowerCase() === 'v' && clipboardObject) {
        event.preventDefault()
        void duplicateObject(clipboardObject)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [clipboardObject, deleteSelected, duplicateObject, selectedObject])

  const getDragPublisher = useCallback(
    (objectId: string) => {
      if (!dragPublishersRef.current[objectId]) {
        let lastDragPublishAt = 0
        dragPublishersRef.current[objectId] = (point: Point) => {
          const now = Date.now()
          if (now - lastDragPublishAt < 100) {
            return
          }

          lastDragPublishAt = now
          void patchObject(objectId, { position: point })
        }
      }

      return dragPublishersRef.current[objectId]
    },
    [patchObject],
  )

  const publishCursorPosition = useCallback((point: Point) => {
    const now = Date.now()
    if (now - lastCursorPublishAtRef.current < 50) {
      return
    }

    lastCursorPublishAtRef.current = now
    if (!presenceRef.current) {
      return
    }

    void update(presenceRef.current, {
      x: point.x,
      y: point.y,
    })
  }, [])

  const handleAiCommandSubmit = async (command: string) => {
    if (!user) {
      throw new Error('Sign in required')
    }

    const idToken = await user.getIdToken()
    const response = await fetch(aiCommandEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        boardId,
        userDisplayName: user.displayName || user.email || 'Anonymous',
        command,
        clientCommandId: crypto.randomUUID(),
      }),
    })

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; result?: { message?: string } }
      | null

    if (!response.ok) {
      throw new Error(payload?.error || 'AI command failed')
    }

    return payload?.result?.message
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!db || !rtdb) {
    return (
      <main className="board-shell">
        <section className="setup-warning">
          <h2>Firebase configuration required</h2>
          <p>Set `VITE_FIREBASE_*` values in `.env` to enable realtime collaboration.</p>
        </section>
      </main>
    )
  }

  return (
    <main className="board-shell">
      <header className="board-header">
        <div>
          <h1>CollabBoard MVP-1</h1>
          <p>
            Board URL: <code>{`${window.location.origin}/b/${boardId}`}</code>
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="secondary-button" onClick={() => void createObject('stickyNote')}>
            Add Sticky
          </button>
          <button type="button" className="secondary-button" onClick={() => void createObject('shape')}>
            Add Rectangle
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              if (selectedObject) {
                void deleteSelected()
              }
            }}
            disabled={!selectedObject}
          >
            Delete Selected
          </button>
          <button type="button" className="secondary-button" onClick={() => void signOutUser()}>
            Sign out
          </button>
        </div>
      </header>

      <section className="board-content">
        <section className="canvas-column">
          <div className="presence-strip">
            {Object.values(cursors).map((cursor) => (
              <span key={cursor.userId} className="presence-pill">
                <span className="presence-dot" style={{ backgroundColor: cursor.color }} />
                {cursor.displayName}
              </span>
            ))}
          </div>

          <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            className="board-stage"
            x={viewport.x}
            y={viewport.y}
            scaleX={viewport.scale}
            scaleY={viewport.scale}
            draggable
            onDragEnd={(event) => {
              if (event.target !== event.currentTarget) {
                return
              }

              const stage = stageRef.current
              if (!stage) {
                return
              }

              setViewport((prev) => ({
                ...prev,
                x: stage.x(),
                y: stage.y(),
              }))
            }}
            onWheel={(event) => {
              event.evt.preventDefault()

              const stage = stageRef.current
              if (!stage) {
                return
              }

              const pointer = stage.getPointerPosition()
              if (!pointer) {
                return
              }

              const scaleBy = 1.05
              const oldScale = viewport.scale
              const nextScale = clamp(
                event.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy,
                0.25,
                3,
              )

              const worldX = (pointer.x - viewport.x) / oldScale
              const worldY = (pointer.y - viewport.y) / oldScale

              setViewport({
                scale: nextScale,
                x: pointer.x - worldX * nextScale,
                y: pointer.y - worldY * nextScale,
              })
            }}
            onMouseMove={(event) => {
              const stage = event.target.getStage()
              const pointer = stage?.getPointerPosition()
              if (!pointer) {
                return
              }

              publishCursorPosition({
                x: (pointer.x - viewport.x) / viewport.scale,
                y: (pointer.y - viewport.y) / viewport.scale,
              })
            }}
            onMouseDown={(event) => {
              if (event.target === event.target.getStage()) {
                setSelectedId(null)
              }
            }}
          >
            <Layer listening={false}>
              <Rect x={-10000} y={-10000} width={20000} height={20000} fill="#f8fafc" />
            </Layer>

            <Layer>
              {objects.map((boardObject) => {
                const selected = boardObject.id === selectedId
                // Use local position during drag, server position otherwise
                const position = localObjectPositions[boardObject.id] || boardObject.position

                if (boardObject.type === 'stickyNote') {
                  return (
                    <Group
                      key={boardObject.id}
                      x={position.x}
                      y={position.y}
                      draggable
                      onClick={() => setSelectedId(boardObject.id)}
                      onTap={() => setSelectedId(boardObject.id)}
                      onDblClick={() => {
                        const nextText = window.prompt('Edit sticky note text', boardObject.text)
                        if (nextText !== null && nextText !== boardObject.text) {
                          void patchObject(boardObject.id, { text: nextText })
                        }
                      }}
                      onDragStart={() => {
                        setDraggingObjectId(boardObject.id)
                      }}
                      onDragMove={(event) => {
                        const newPos = { x: event.target.x(), y: event.target.y() }
                        setlocalObjectPositions((prev) => ({ ...prev, [boardObject.id]: newPos }))
                        getDragPublisher(boardObject.id)(newPos)
                      }}
                      onDragEnd={(event) => {
                        const finalPos = { x: event.target.x(), y: event.target.y() }
                        setlocalObjectPositions((prev) => {
                          const next = { ...prev }
                          delete next[boardObject.id]
                          return next
                        })
                        setDraggingObjectId(null)
                        void patchObject(boardObject.id, { position: finalPos })
                      }}
                    >
                      <Rect
                        width={boardObject.size.width}
                        height={boardObject.size.height}
                        fill={boardObject.color}
                        cornerRadius={8}
                        stroke={selected ? '#1d4ed8' : '#0f172a'}
                        strokeWidth={selected ? 2 : 1}
                        shadowBlur={6}
                        shadowOpacity={0.2}
                      />
                      <Text
                        text={boardObject.text}
                        width={boardObject.size.width - 16}
                        x={8}
                        y={8}
                        fontSize={16}
                        fill="#0f172a"
                        wrap="word"
                      />
                    </Group>
                  )
                }

                return (
                  <Rect
                    key={boardObject.id}
                    x={position.x}
                    y={position.y}
                    width={boardObject.size.width}
                    height={boardObject.size.height}
                    fill={boardObject.color}
                    stroke={selected ? '#1d4ed8' : '#0f172a'}
                    strokeWidth={selected ? 2 : 1}
                    draggable
                    cornerRadius={8}
                    onClick={() => setSelectedId(boardObject.id)}
                    onTap={() => setSelectedId(boardObject.id)}
                    onDragStart={() => {
                      setDraggingObjectId(boardObject.id)
                    }}
                    onDragMove={(event) => {
                      const newPos = { x: event.target.x(), y: event.target.y() }
                      setlocalObjectPositions((prev) => ({ ...prev, [boardObject.id]: newPos }))
                      getDragPublisher(boardObject.id)(newPos)
                    }}
                    onDragEnd={(event) => {
                      const finalPos = { x: event.target.x(), y: event.target.y() }
                      setlocalObjectPositions((prev) => {
                        const next = { ...prev }
                        delete next[boardObject.id]
                        return next
                      })
                      setDraggingObjectId(null)
                      void patchObject(boardObject.id, { position: finalPos })
                    }}
                  />
                )
              })}
            </Layer>

            <Layer listening={false}>
              {Object.values(cursors)
                .filter((cursor) => cursor.userId !== user.uid)
                .map((cursor) => (
                  <Group key={cursor.userId} x={cursor.x} y={cursor.y}>
                    <Circle radius={5} fill={cursor.color} />
                    <Rect x={8} y={-12} width={120} height={20} fill={cursor.color} cornerRadius={4} />
                    <Text x={12} y={-9} text={cursor.displayName} fontSize={11} fill="#ffffff" />
                  </Group>
                ))}
            </Layer>
          </Stage>
        </section>

        <AICommandPanel disabled={!user} onSubmit={handleAiCommandSubmit} />
      </section>
    </main>
  )
}

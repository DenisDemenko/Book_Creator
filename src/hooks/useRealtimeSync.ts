import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Book, 
  UserRole, 
  NavigationTab, 
  CollaboratorPresence, 
  CollabChatMessage, 
  RealtimeSyncStatus, 
  BookVersionSnapshot, 
  AuditLogEntry 
} from '../types';
import { getRoleInfo } from '../utils/rbac';
import { realtimeSocketUrl } from '../utils/basePath';
import type { SectionPatch } from '../utils/bookDiff';
import { isNewerBook, describeRevisionGap } from '../utils/bookVersion';
import { stableClientId, deviceLabel } from '../utils/deviceSession';

/** Мінімальний проміжок між відправками одного каналу, мс. */
const BROADCAST_INTERVAL_MS = 500;

interface ThrottleState {
  timer: ReturnType<typeof setTimeout> | null;
  pending: unknown;
  lastSentAt: number;
}

interface UseRealtimeSyncProps {
  book: Book;
  currentRole: UserRole;
  currentTab: NavigationTab;
  activeChapterId?: string;
  activeSectionId?: string;
  userName?: string;
  onRemoteBookUpdate: (updatedBook: Book, logEntry?: AuditLogEntry) => void;
  onRemoteVersionSnapshot?: (snapshot: BookVersionSnapshot, updatedBook: Book) => void;
  onRemoteLogEntry?: (logEntry: AuditLogEntry) => void;
  /** Точкова правка секції від співавтора. */
  onRemoteSectionPatch?: (patch: SectionPatch) => void;
  /**
   * Прийшла копія книги СТАРІША за нашу — ми її відхилили. Викликається, щоб
   * інтерфейс міг попередити автора: та сама книга відкрита ще десь і там
   * застарілий стан.
   */
  onStaleRemoteRejected?: (staleBook: Book, gapLabel: string) => void;
}

const COLLAB_COLORS = [
  '#f59e0b', // Amber
  '#06b6d4', // Cyan
  '#ec4899', // Pink
  '#10b981', // Emerald
  '#8b5cf6', // Purple
  '#3b82f6', // Blue
  '#f97316', // Orange
];

export function useRealtimeSync({
  book,
  currentRole,
  currentTab,
  activeChapterId,
  activeSectionId,
  userName,
  onRemoteBookUpdate,
  onRemoteVersionSnapshot,
  onRemoteLogEntry,
  onRemoteSectionPatch,
  onStaleRemoteRejected
}: UseRealtimeSyncProps) {
  const [syncStatus, setSyncStatus] = useState<RealtimeSyncStatus>('connecting');
  const [collaborators, setCollaborators] = useState<CollaboratorPresence[]>([]);
  const [chatMessages, setChatMessages] = useState<CollabChatMessage[]>([]);
  // Сталий на цей браузер: інакше кожне перезавантаження сторінки
  // створювало нового «співавтора», і список присутніх заповнювався
  // привидами тієї самої вкладки.
  const [clientId, setClientId] = useState<string>(() => stableClientId());
  const deviceLabelRef = useRef<string>(deviceLabel());

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const throttleRef = useRef<{ book: ThrottleState; patch: ThrottleState }>({
    book: { timer: null, pending: null, lastSentAt: 0 },
    patch: { timer: null, pending: null, lastSentAt: 0 },
  });
  const reconnectAttemptsRef = useRef<number>(0);
  const isUnmountedRef = useRef<boolean>(false);
  // Колір обирається один раз на сесію. Раніше тут лежала функція, яку
  // викликали при кожному під'єднанні, тож колір користувача стрибав
  // після кожного реконекту.
  const myColorRef = useRef<string>(
    COLLAB_COLORS[Math.floor(Math.random() * COLLAB_COLORS.length)]
  );

  /**
   * Надсилання з обмеженням частоти.
   *
   * Перше повідомлення йде негайно (щоб співавтор побачив початок правки без
   * затримки), далі не частіше ніж раз на BROADCAST_INTERVAL_MS. Проміжні
   * стани відкидаються, залишається лише найсвіжіший — саме він піде
   * завершальною відправкою. Так набір тексту зі швидкістю 300 знаків/хв
   * дає ~2 повідомлення на секунду замість ~5 на секунду з повною книгою.
   */
  const sendThrottled = useCallback((key: 'book' | 'patch', build: () => unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    const state = throttleRef.current[key];
    const sinceLast = now - state.lastSentAt;

    const flush = () => {
      const pending = throttleRef.current[key].pending;
      throttleRef.current[key].pending = null;
      throttleRef.current[key].timer = null;
      throttleRef.current[key].lastSentAt = Date.now();
      const socket = wsRef.current;
      if (pending && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(pending));
      }
    };

    if (sinceLast >= BROADCAST_INTERVAL_MS && !state.timer) {
      state.lastSentAt = now;
      ws.send(JSON.stringify(build()));
      return;
    }

    // Запам'ятовуємо найсвіжіший стан і чекаємо кінця вікна.
    state.pending = build();
    if (!state.timer) {
      state.timer = setTimeout(flush, Math.max(0, BROADCAST_INTERVAL_MS - sinceLast));
    }
  }, []);

  /** Примусово відправляє все відкладене — перед розривом чи важливою подією. */
  const flushPending = useCallback(() => {
    (['book', 'patch'] as const).forEach((key) => {
      const state = throttleRef.current[key];
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      const pending = state.pending;
      state.pending = null;
      const socket = wsRef.current;
      if (pending && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(pending));
        state.lastSentAt = Date.now();
      }
    });
  }, []);

  // Keep references to latest props to prevent stale closure issues
  const bookRef = useRef<Book>(book);
  bookRef.current = book;
  // Колбек тримаємо в ref: обробник повідомлень живе всередині ефекту
  // під'єднання і не має перестворюватись через зміну пропса.
  const onStaleRemoteRejectedRef = useRef(onStaleRemoteRejected);
  onStaleRemoteRejectedRef.current = onStaleRemoteRejected;
  const currentRoleRef = useRef<UserRole>(currentRole);
  currentRoleRef.current = currentRole;
  const currentTabRef = useRef<NavigationTab>(currentTab);
  currentTabRef.current = currentTab;
  const userNameRef = useRef<string>(userName || getRoleInfo(currentRole).defaultPersona.name);
  userNameRef.current = userName || getRoleInfo(currentRole).defaultPersona.name;

  // Determine user display name
  const effectiveUserName = userName || (book.author ? `${book.author} (${getRoleInfo(currentRole).nameUk})` : getRoleInfo(currentRole).defaultPersona.name);

  // Initialize or connect WebSocket
  const connectWebSocket = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (isUnmountedRef.current) return;

    // Гасимо попереднє з'єднання, попередньо знявши обробники.
    // Інакше його onclose сприймає навмисну заміну за обрив і планує
    // реконект — що й породжувало нескінченний цикл перепідключень.
    const previous = wsRef.current;
    if (previous) {
      previous.onopen = null;
      previous.onmessage = null;
      previous.onerror = null;
      previous.onclose = null;
      try {
        previous.close();
      } catch (e) {
        // ignore
      }
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setSyncStatus('connecting');

    // Не збираємо URL тут: під префіксом /studio (Фаза G3) WebSocket іде
    // повз проксі, напряму на хост Nova — див. realtimeSocketUrl().
    const wsUrl = realtimeSocketUrl();

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        setSyncStatus('connected');
        reconnectAttemptsRef.current = 0;

        // Join the book room
        const joinPayload = {
          type: 'client:join',
          payload: {
            bookId: bookRef.current.id || 'BK-2084-CYBER',
            initialBook: bookRef.current,
            user: {
              clientId,
              userId: clientId,
              userName: userNameRef.current,
              role: currentRoleRef.current,
              currentTab: currentTabRef.current,
              activeChapterId,
              activeSectionId,
              color: myColorRef.current,
              deviceLabel: deviceLabelRef.current,
              lastActive: new Date().toISOString()
            }
          }
        };

        ws.send(JSON.stringify(joinPayload));

        // Start ping keepalive every 20 seconds
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 20000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const { type, payload, senderId } = data;

          switch (type) {
            case 'room:sync': {
              // Initial state received from server
              if (payload.assignedClientId) {
                setClientId(payload.assignedClientId);
              }
              if (payload.presenceList) {
                setCollaborators(payload.presenceList);
              }
              if (payload.chatHistory) {
                setChatMessages(payload.chatHistory);
              }
              // If server has newer book state, sync it
              if (payload.book && payload.book.updatedAt && bookRef.current.updatedAt) {
                const serverTime = new Date(payload.book.updatedAt).getTime();
                const localTime = new Date(bookRef.current.updatedAt).getTime();
                if (serverTime > localTime) {
                  onRemoteBookUpdate(payload.book);
                }
              }
              break;
            }

            case 'presence:update': {
              if (payload.presenceList) {
                setCollaborators(payload.presenceList);
              }
              break;
            }

            case 'book:remote_update': {
              if (payload.book && senderId !== clientId) {
                // Копія співавтора застосовується ЛИШЕ якщо вона новіша за
                // нашу. Доти будь-яка вхідна книга приймалась беззастережно,
                // і сесія зі старим станом (та сама книга, відкрита в іншому
                // браузері чи на іншому пристрої) мовчки затирала свіжий
                // текст — саме так втрачалась робота.
                if (isNewerBook(payload.book, bookRef.current)) {
                  onRemoteBookUpdate(payload.book, payload.logEntry);
                } else {
                  // Наша копія свіжіша: не мовчимо, а віддаємо її назад, щоб
                  // відсталий клієнт наздогнав. Інакше два пристрої лишились
                  // би розбіжними до наступної правки.
                  onStaleRemoteRejectedRef.current?.(payload.book, describeRevisionGap(payload.book, bookRef.current));
                  const ws = wsRef.current;
                  if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(
                      JSON.stringify({
                        type: 'book:update',
                        payload: {
                          bookId: bookRef.current.id || 'BK-2084-CYBER',
                          updatedBook: bookRef.current
                        }
                      })
                    );
                  }
                }
              }
              break;
            }

            case 'section:remote_patch': {
              if (payload.patch && senderId !== clientId && onRemoteSectionPatch) {
                onRemoteSectionPatch(payload.patch as SectionPatch);
              }
              break;
            }

            case 'version:snapshot_created': {
              if (payload.snapshot && onRemoteVersionSnapshot) {
                onRemoteVersionSnapshot(payload.snapshot, payload.book);
              }
              break;
            }

            case 'chat:message': {
              if (payload.message) {
                setChatMessages((prev) => [...prev, payload.message]);
              }
              break;
            }

            case 'user:joined': {
              // Add system notification in chat or update presence
              if (payload.user && payload.user.clientId !== clientId) {
                // Presence list will update via presence:update
              }
              break;
            }

            case 'user:left': {
              // Handled by presence:update
              break;
            }
          }
        } catch (err) {
          console.error('Error handling WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        // Якщо цей сокет уже не активний — його закрили ми самі, реконект зайвий.
        if (wsRef.current !== ws) return;
        if (isUnmountedRef.current) return;

        setSyncStatus('disconnected');
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);

        // Наростаюча пауза: 3, 6, 12, 24, далі 30 с — щоб не бомбардувати
        // сервер, який лежить, і не палити батарею на мобільному.
        const attempt = reconnectAttemptsRef.current;
        const delay = Math.min(3000 * Math.pow(2, attempt), 30000);
        reconnectAttemptsRef.current = attempt + 1;

        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, delay);
      };

      ws.onerror = (err) => {
        console.warn('WebSocket error:', err);
        setSyncStatus('disconnected');
      };
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      setSyncStatus('disconnected');
    }
  }, [clientId, activeChapterId, activeSectionId, onRemoteBookUpdate, onRemoteVersionSnapshot]);

  // Initial connection & reconnection on bookId change
  useEffect(() => {
    isUnmountedRef.current = false;
    connectWebSocket();

    return () => {
      isUnmountedRef.current = true;
      // Віддаємо відкладені правки, перш ніж рвати з'єднання.
      flushPending();
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        try {
          ws.close();
        } catch (e) {
          // ignore
        }
      }
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, [book.id]);

  // Остання правка не має загубитися при закритті вкладки.
  useEffect(() => {
    const handler = () => flushPending();
    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  }, [flushPending]);

  // Sync presence status whenever tab, section, or role changes
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const statusPayload = {
        type: 'presence:status',
        payload: {
          bookId: book.id || 'BK-2084-CYBER',
          status: {
            role: currentRole,
            currentTab,
            activeChapterId,
            activeSectionId,
            userName: effectiveUserName
          }
        }
      };
      wsRef.current.send(JSON.stringify(statusPayload));
    }
  }, [currentRole, currentTab, activeChapterId, activeSectionId, effectiveUserName, book.id]);

  /**
   * Компактне оновлення однієї секції. Використовується під час набору
   * тексту замість пересилання всієї книги.
   */
  const broadcastSectionPatch = useCallback((patch: SectionPatch, bookId?: string) => {
    sendThrottled('patch', () => ({
      type: 'section:patch',
      payload: {
        bookId: bookId || bookRef.current.id || 'BK-2084-CYBER',
        patch
      }
    }));
  }, [sendThrottled]);

  // Broadcast book updates over WebSockets
  const broadcastBookUpdate = useCallback((updatedBook: Book, logEntry?: AuditLogEntry) => {
    // Запис у журнал — подія, яку не можна загубити в throttle-вікні,
    // тож такі оновлення йдуть негайно.
    if (logEntry) {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        throttleRef.current.book.lastSentAt = Date.now();
        ws.send(
          JSON.stringify({
            type: 'book:update',
            payload: { bookId: updatedBook.id || 'BK-2084-CYBER', updatedBook, logEntry }
          })
        );
      }
      return;
    }

    sendThrottled('book', () => ({
      type: 'book:update',
      payload: { bookId: updatedBook.id || 'BK-2084-CYBER', updatedBook }
    }));
  }, [sendThrottled]);

  // Broadcast version snapshots over WebSockets
  const broadcastSnapshot = useCallback((snapshot: BookVersionSnapshot, updatedBook: Book) => {
    // Зліпок має включати найсвіжіший текст, тож спершу віддаємо відкладене.
    flushPending();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'version:snapshot_created',
          payload: {
            bookId: updatedBook.id || 'BK-2084-CYBER',
            snapshot,
            updatedBook
          }
        })
      );
    }
  }, [flushPending]);

  // Send collaboration chat message
  const sendChatMessage = useCallback((text: string, tabContext?: NavigationTab) => {
    if (!text.trim()) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'chat:send',
          payload: {
            bookId: book.id || 'BK-2084-CYBER',
            text: text.trim(),
            tabContext: tabContext || currentTab,
            senderName: effectiveUserName,
            role: currentRole,
            color: myColorRef.current
          }
        })
      );
    } else {
      // Fallback local append if disconnected
      const fallbackMsg: CollabChatMessage = {
        id: `msg-${Date.now()}`,
        clientId: 'local',
        senderName: effectiveUserName,
        role: currentRole,
        color: myColorRef.current,
        message: text.trim(),
        timestamp: new Date().toISOString(),
        tabContext: tabContext || currentTab
      };
      setChatMessages((prev) => [...prev, fallbackMsg]);
    }
  }, [book.id, currentTab, currentRole, effectiveUserName]);

  // Broadcast typing / active presence
  const broadcastTyping = useCallback((isTyping: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'presence:status',
          payload: {
            bookId: book.id || 'BK-2084-CYBER',
            status: { isTyping }
          }
        })
      );
    }
  }, [book.id]);

  return {
    syncStatus,
    isOnline: syncStatus === 'connected',
    collaborators,
    otherCollaborators: collaborators.filter((c) => c.clientId !== clientId),
    activeUsersCount: collaborators.length,
    chatMessages,
    myClientId: clientId,
    myColor: myColorRef.current,
    sendChatMessage,
    broadcastBookUpdate,
    broadcastSectionPatch,
    broadcastSnapshot,
    broadcastTyping,
    flushPending,
    reconnect: connectWebSocket
  };
}

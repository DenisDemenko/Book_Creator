import { useEffect, useRef, useState } from "react";
import type { Book } from "../types";
import { apiPath } from "../utils/basePath";

const KEY = "nova_pending_funding_promotion";
const validId = (id: string | null) =>
  Boolean(
    id &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    ),
  );
export function pendingFundingPromotion(): string | null {
  if (typeof window === "undefined") return null;
  const id = new URLSearchParams(location.search).get("fundingPromotion");
  try {
    if (validId(id)) {
      sessionStorage.setItem(KEY, id!);
      return id;
    }
    const saved = sessionStorage.getItem(KEY);
    return validId(saved) ? saved : null;
  } catch {
    return validId(id) ? id : null;
  }
}
function clearPending() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* Storage may be unavailable. */
  }
  const url = new URL(location.href);
  url.searchParams.delete("fundingPromotion");
  history.replaceState({}, "", url);
}
async function request<T>(path: string, method = "GET"): Promise<T> {
  const response = await fetch(apiPath(path), {
    method,
    credentials: "include",
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Не вдалося обробити матеріал.");
  return data as T;
}
function returnAddress(value: string) {
  const url = new URL(value);
  const allowed = ["https://www.fusionlab.in.ua", "https://fusionlab.in.ua"];
  if (import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(url.hostname))
    allowed.push(url.origin);
  if (
    !allowed.includes(url.origin) ||
    !/^\/account\/crowdfunding\/[a-zA-Z0-9-]+\/promotion$/.test(url.pathname)
  )
    throw Error("Непідтримувана адреса маркетплейсу.");
  return url.href;
}
type Context = {
  documentId: string;
  kind: "letter" | "book";
  returnUrl: string;
};
export function FundingPromotionWorkspace({
  book,
  userId,
  loading,
  pendingId,
  onEntryHandled,
  onOpen,
  onSave,
  onUpdate,
}: {
  book: Book;
  userId?: string;
  loading: boolean;
  pendingId: string | null;
  onEntryHandled: () => void;
  onOpen: (book: Book, revision: number) => Promise<void>;
  onSave: () => Promise<boolean>;
  onUpdate: (book: Book) => void;
}) {
  const [context, setContext] = useState<Context | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const callbacks = useRef({ onEntryHandled, onOpen, onSave });
  useEffect(() => {
    callbacks.current = { onEntryHandled, onOpen, onSave };
  }, [onEntryHandled, onOpen, onSave]);
  useEffect(() => {
    if (!pendingId || !userId || loading) return;
    let active = true;
    setBusy(true);
    setError("");
    void request<{ book: Book; revision: number; returnUrl: string }>(
      `/api/funding-promotions/${pendingId}/open`,
      "POST",
    )
      .then(async (value) => {
        if (!active) return;
        await callbacks.current.onOpen(value.book, value.revision);
        if (!active) return;
        clearPending();
        callbacks.current.onEntryHandled();
        setContext({
          documentId: pendingId,
          kind: value.book.fundingPromotion?.kind || "letter",
          returnUrl: value.returnUrl,
        });
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [pendingId, userId, loading, attempt]);
  useEffect(() => {
    let active = true;
    setContext(null);
    if (!book.fundingPromotion || !userId || loading) return;
    void request<Context>(
      `/api/funding-promotions/books/${encodeURIComponent(book.id)}/context`,
    )
      .then((c) => {
        if (active) setContext(c);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [book.id, Boolean(book.fundingPromotion), userId, loading]);
  async function sendBack() {
    if (!context) return;
    setBusy(true);
    setError("");
    try {
      if (!(await callbacks.current.onSave()))
        throw Error("Спочатку збережіть поточні правки книги.");
      const result = await request<{ returnUrl: string; applied: boolean }>(
        `/api/funding-promotions/books/${encodeURIComponent(book.id)}/return`,
        "POST",
      );
      location.assign(returnAddress(result.returnUrl));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  if (!pendingId && !book.fundingPromotion) return null;
  return (
    <section
      className="shrink-0 m-3 rounded-xl border border-cyan-500/40 bg-slate-950/95 p-4 text-slate-100"
      data-funding-promotion
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">
            Fusion Lab · підтримка STEAM
          </p>
          <h2 className="text-lg font-bold">
            {context?.kind === "book"
              ? "Мотиваційна книга проєкту"
              : "Мотиваційний лист проєкту"}
          </h2>
        </div>
        {busy && (
          <p role="status" className="text-sm text-cyan-300">
            {pendingId
              ? "Відкриваємо матеріал…"
              : "Зберігаємо та повертаємо матеріал…"}
          </p>
        )}
      </div>
      {pendingId && !userId && (
        <p className="mt-2 text-sm">
          Увійдіть тим самим обліковим записом, що й у маркетплейс, щоб відкрити
          свій матеріал.
        </p>
      )}
      {context && (
        <>
          <p className="my-3 text-sm text-slate-300">
            Редагуйте матеріал у розділі «Книга та текст». Повернений текст
            з’явиться у вашому кабінеті маркетплейсу для перегляду й розсилки.
            {context.kind === "book"
              ? " Актуальний PDF буде підготовлено через DesignCraft."
              : ""}
          </p>
          <label className="block text-sm">
            Тема поштового листа
            <input
              maxLength={180}
              className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 p-2 text-slate-100"
              value={book.subtitle || ""}
              disabled={busy}
              onChange={(e) => onUpdate({ ...book, subtitle: e.target.value })}
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              disabled={busy}
              onClick={() => void sendBack()}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {context.kind === "book"
                ? "Повернути книгу й PDF до маркетплейсу"
                : "Повернути лист до маркетплейсу"}
            </button>
            <a
              href={context.returnUrl}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm"
            >
              Кабінет автора ↗
            </a>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-amber-300">
          {error}
        </p>
      )}
      {pendingId && error && (
        <div className="mt-3 flex gap-3">
          <button disabled={busy} onClick={() => setAttempt((n) => n + 1)}>
            Спробувати ще раз
          </button>
          <button
            onClick={() => {
              clearPending();
              onEntryHandled();
              setError("");
            }}
          >
            Скасувати перехід
          </button>
        </div>
      )}
    </section>
  );
}

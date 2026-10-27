"use strict";
window.SlabBridge = (() => {
  const pending = new Map();
  window.addEventListener("message", (e) => {
    if (
      e.origin !== location.origin ||
      e.source !== parent ||
      e.data?.type !== "slab:response"
    )
      return;
    const p = pending.get(e.data.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(e.data.id);
    if (e.data.error) {
      const error = Error(e.data.error);
      error.status = e.data.status;
      p.reject(error);
    }
    else p.resolve(e.data.result);
  });
  return {
    request: (method, path, body) =>
      new Promise((resolve, reject) => {
        if (parent === window) {
          reject(
            Error(
              "Відкрийте конструктор через сторінку /table-builder маркетплейсу.",
            ),
          );
          return;
        }
        const id = crypto.randomUUID(),
          timer = setTimeout(() => {
            pending.delete(id);
            reject(
              Error("API не відповідає. Перевірте з’єднання та повторіть дію."),
            );
          }, 30000);
        pending.set(id, { resolve, reject, timer });
        parent.postMessage(
          { type: "slab:request", id, method, path, body },
          location.origin,
        );
      }),
    navigate: (path) =>
      parent.postMessage({ type: "slab:navigate", path }, location.origin),
  };
})();

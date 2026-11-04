"""Станний режим моку: чернетки живуть у памʼяті й проходять шлях collecting → structured → written → submitted.

Для розробки сторінки без справжньої Studio (`grabfusion-mock --stateful`). Форми відповідей — ті самі,
що у фікстурах A0 (перевіряються схемою в тестах); тексти — вигадані моком. Прохід ШІ «триває» кілька
опитувань (`ticks`), як справжній: 202 → GET показує `job.running` → потім результат.
"""
from __future__ import annotations

import base64
import binascii
import copy
from datetime import datetime, timezone
from typing import Any

from . import contract

Result = tuple[int, dict[str, Any]]
STRUCTURE_TICKS = 2
GENERATE_TICKS = 1


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _err(status: int, kind: str, message: str, **extra: Any) -> Result:
    return status, {"error": message, "kind": kind, **extra}


class Sim:
    def __init__(self) -> None:
        self.drafts: dict[str, dict[str, Any]] = {}
        self.ticks: dict[str, int] = {}
        self.pending: dict[str, Any] = {}
        self.clients: dict[tuple[str, str], str] = {}
        self.images: dict[tuple[str, str], bytes] = {}  # завантажені фото: мок віддає їх назад, як справжня Studio
        self.counter = 0
        self.limits = contract.default_limits()

    # --- допоміжне ------------------------------------------------------
    def _next(self, prefix: str) -> str:
        self.counter += 1
        return f"{prefix}_sim{self.counter:04d}"

    def _get(self, draft_id: str) -> dict[str, Any] | None:
        return self.drafts.get(draft_id)

    @staticmethod
    def _bump(d: dict[str, Any]) -> None:
        d["revision"] += 1
        d["updatedAt"] = _now()

    def _tick(self, d: dict[str, Any]) -> None:
        """Один «опит»: описуються кадри, просувається фонова робота."""
        for p in d["photos"]:
            if p["status"] == "processing":
                p["status"] = "described"
                if d["kind"] == "manuscript":
                    hint = next((n["text"] for n in d["notes"] if p["photoId"] in n["photoIds"]), "")
                    p["text"] = "" if "порожня" in hint else f"Сторінка {p['order']}: розпізнаний текст (мок). {hint}".strip()
                    p["textEdited"] = False
                else:
                    p["description"] = f"Кадр {p['order']}: мок-опис того, що видно на фото."
                    p["tags"] = ["мок", "кадр"]
        job = d["job"]
        if job and job["status"] == "running":
            left = self.ticks.get(d["draftId"], 0) - 1
            self.ticks[d["draftId"]] = left
            if left <= 0:
                self._finish_job(d, job)

    def _finish_job(self, d: dict[str, Any], job: dict[str, Any]) -> None:
        if job["kind"] == "structure":
            ref = contract.load_fixture("get-draft-structured")["draft"]
            by_order = [p["photoId"] for p in sorted(d["photos"], key=lambda p: p["order"])]
            structure = copy.deepcopy(ref["structure"])
            # кадри чернетки розкладаємо по урокам по колу — кожен у рівно одному уроці
            lessons = [les for m in structure["modules"] for les in m["lessons"]]
            for les in lessons:
                les["photoIds"] = []
            for i, pid in enumerate(by_order):
                lessons[min(i * len(lessons) // max(len(by_order), 1), len(lessons) - 1)]["photoIds"].append(pid)
            d["structure"] = structure
            d["assumptions"] = copy.deepcopy(ref["assumptions"])
            if not d["title"]:
                d["title"] = ref["title"]
            d["status"] = "structured"
        else:
            m = next((m for m in d["structure"]["modules"] if m["moduleId"] == job["moduleId"]), None)
            if m:
                for les in m["lessons"]:
                    les["body"] = f"Текст уроку «{les['title']}» (мок). Крок за кроком за кадрами уроку."
                    for f in ("body", "goal", "topics", "title"):
                        if f not in les["aiFields"]:
                            les["aiFields"].append(f)
                    les["goal"] = les["goal"] or "Мета уроку (мок)."
                m["written"] = True
            if all(x["written"] for x in d["structure"]["modules"]):
                d["status"] = "written"
        d["job"] = None
        d["updatedAt"] = _now()

    def _image_url(self, draft_id: str, photo_id: str) -> str:
        return f"/api/external/v1/photo-drafts/{draft_id}/photos/{photo_id}/image"

    def image(self, draft_id: str, photo_id: str) -> bytes | None:
        return self.images.get((draft_id, photo_id))

    # --- маршрути -------------------------------------------------------
    def handle(self, route: str, params: dict[str, str], body: Any) -> Result | None:
        name = route.split(" ", 1)[1].replace("/photo-drafts", "", 1) or "/"
        method = route.split(" ", 1)[0]
        did = params.get("draftId")
        if (method, name) == ("GET", "/") :
            return 200, {"drafts": [
                {"draftId": d["draftId"], "kind": d["kind"], "status": d["status"], "title": d["title"],
                 "photoCount": len(d["photos"]), "updatedAt": d["updatedAt"]}
                for d in reversed(list(self.drafts.values())) if d["status"] != "discarded"]}
        if (method, name) == ("POST", "/"):
            return self._create(body)
        if did is None:
            return None  # limits тощо — звичайна фікстура
        d = self._get(did)
        if d is None:
            return _err(404, "draft_not_found", "Чернетки немає або вона чужа.")
        if name.endswith("/image"):
            return None
        if method == "GET" and name == "/:draftId":
            self._tick(d)
            return 200, {"draft": copy.deepcopy(d)}
        if method == "PATCH" and name == "/:draftId":
            return self._patch(d, body)
        if method == "DELETE" and name == "/:draftId":
            if d["status"] == "submitted":
                return _err(409, "wrong_status", "Відправлену чернетку не можна відкинути.")
            d["status"] = "discarded"
            self._bump(d)
            return 200, {"draft": copy.deepcopy(d)}
        if method == "POST" and name.endswith("/photos"):
            return self._add_photo(d, body)
        if method == "POST" and name.endswith("/retry"):
            p = self._photo(d, params["photoId"])
            if p is None:
                return _err(404, "photo_not_found", "Кадру немає в цій чернетці.")
            if p["status"] != "failed":
                return _err(409, "wrong_status", "Кадр не в стані failed.")
            p["status"], p["error"] = "processing", None
            return 202, {"photo": copy.deepcopy(p), "revision": d["revision"], "duplicate": False}
        if method == "DELETE" and "/photos/" in name:
            p = self._photo(d, params["photoId"])
            if p is None:
                return _err(404, "photo_not_found", "Кадру немає в цій чернетці.")
            d["photos"].remove(p)
            for i, q in enumerate(sorted(d["photos"], key=lambda x: x["order"]), 1):
                q["order"] = i
            for n in d["notes"]:
                n["photoIds"] = [x for x in n["photoIds"] if x != p["photoId"]]
            d["notes"] = [n for n in d["notes"] if n["photoIds"]]
            self._bump(d)
            return 200, {"draft": copy.deepcopy(d)}
        if method == "PUT" and "/notes/" in name:
            return self._put_note(d, params["noteId"], body)
        if method == "DELETE" and "/notes/" in name:
            n = next((n for n in d["notes"] if n["noteId"] == params["noteId"]), None)
            if n is None:
                return _err(404, "note_not_found", "Опису немає.")
            d["notes"].remove(n)
            self._bump(d)
            return 200, {"draft": copy.deepcopy(d)}
        if method == "PUT" and name.endswith("/text"):
            return self._put_text(d, params["photoId"], body)
        if method == "POST" and name.endswith("/structure"):
            return self._structure(d, body)
        if method == "POST" and name.endswith("/generate"):
            return self._generate(d, params["moduleId"])
        if method == "POST" and name.endswith("/submit"):
            return self._submit(d)
        return None

    @staticmethod
    def _photo(d: dict[str, Any], photo_id: str) -> dict[str, Any] | None:
        return next((p for p in d["photos"] if p["photoId"] == photo_id), None)

    def _create(self, body: Any) -> Result:
        if not isinstance(body, dict) or body.get("kind") not in {"course", "instruction", "book", "manuscript"}:
            return _err(400, "bad_input", "Невалідний kind.")
        open_n = sum(1 for d in self.drafts.values() if d["status"] not in {"submitted", "discarded"})
        if open_n >= self.limits["maxOpenDrafts"]:
            return _err(409, "too_many_drafts", "Забагато відкритих чернеток.")
        bad = self._check_instruction_fields(body["kind"], body) or self._check_book_fields(body["kind"], body)
        if bad:
            return bad
        base = contract.load_fixture("create-draft")["draft"]
        did = self._next("pd")
        d = copy.deepcopy(base)
        d.update(draftId=did, kind=body["kind"], status="collecting", revision=1, photos=[], notes=[],
                 structure=None, assumptions=[], job=None, submitted=None, createdAt=_now(), updatedAt=_now())
        for f in ("title", "craft", "audience", "level", "bookId", "instructionMode", "modelCode", "newBookTitle"):
            d[f] = body.get(f)
        if body["kind"] == "instruction":
            d["instructionMode"] = body.get("instructionMode") or "assembly"
        self.drafts[did] = d
        return 201, {"draft": copy.deepcopy(d)}

    @staticmethod
    def _check_book_fields(kind: str, body: dict[str, Any], current: dict[str, Any] | None = None) -> Result | None:
        """bookId обовʼязковий для book; для manuscript — bookId АБО newBookTitle; newBookTitle лише в рукописі."""
        if body.get("newBookTitle") is not None and kind != "manuscript":
            return _err(400, "bad_input", "newBookTitle — лише для рукопису.")
        if body.get("bookId") is not None and kind not in {"book", "manuscript"}:
            return _err(400, "bad_input", "bookId — лише для книги чи рукопису.")
        book = body.get("bookId") if "bookId" in body else (current or {}).get("bookId")
        new = body.get("newBookTitle") if "newBookTitle" in body else (current or {}).get("newBookTitle")
        if kind == "manuscript" and book and new:
            return _err(400, "bad_input", "Оберіть або існуючу книгу, або нову — не обидві.")
        if kind == "book" and current is None and not body.get("bookId"):
            return _err(400, "bad_input", "Для глави потрібен bookId.")
        if book and str(book).startswith("bk_missing"):
            return _err(404, "book_not_found", "Книги немає або вона чужа.")
        return None

    @staticmethod
    def _check_instruction_fields(kind: str, body: dict[str, Any]) -> Result | None:
        """instructionMode / modelCode — лише для kind: instruction (контракт: інакше 400 bad_input)."""
        if kind != "instruction" and (body.get("instructionMode") is not None or body.get("modelCode") is not None):
            return _err(400, "bad_input", "Режим і код виробу — лише для інструкції.")
        if body.get("instructionMode") is not None and body["instructionMode"] not in {"assembly", "operation"}:
            return _err(400, "bad_input", "instructionMode: assembly або operation.")
        return None

    def _replace_structure(self, d: dict[str, Any], new: Any) -> Result | None:
        mods = new.get("modules") if isinstance(new, dict) else None
        if not isinstance(mods, list):
            return _err(400, "bad_input", "structure.modules — масив модулів.")
        known = {p["photoId"] for p in d["photos"]}
        old = {les["lessonId"]: les for m in (d["structure"] or {"modules": []})["modules"] for les in m["lessons"]}
        seen: set[str] = set()
        out = []
        for m in mods:
            if not isinstance(m, dict) or not isinstance(m.get("moduleId"), str) or m["moduleId"] in seen:
                return _err(400, "bad_input", "Кожен модуль має унікальний moduleId.")
            seen.add(m["moduleId"])
            lessons = []
            for les in m.get("lessons") or []:
                if not isinstance(les, dict) or not isinstance(les.get("lessonId"), str) or les["lessonId"] in seen:
                    return _err(400, "bad_input", "Кожен урок має унікальний lessonId.")
                seen.add(les["lessonId"])
                ids = les.get("photoIds") or []
                miss = next((i for i in ids if i not in known), None)
                if miss:
                    return _err(404, "photo_not_found", f"Кадру {miss} немає в цій чернетці.")
                new_les = {"lessonId": les["lessonId"], "title": les.get("title") or "", "goal": les.get("goal"),
                           "photoIds": list(ids), "body": les.get("body"), "topics": list(les.get("topics") or []),
                           "aiFields": []}
                prev = old.get(les["lessonId"])
                if prev:
                    new_les["aiFields"] = [f for f in prev["aiFields"] if prev.get(f) == new_les.get(f)]
                lessons.append(new_les)
            out.append({"moduleId": m["moduleId"], "title": m.get("title") or "", "summary": m.get("summary"),
                        "lessons": lessons, "written": bool(lessons) and all(x["body"] for x in lessons)})
        d["structure"] = {"modules": out}
        return None

    def _patch(self, d: dict[str, Any], body: Any) -> Result:
        if not isinstance(body, dict) or not isinstance(body.get("ifRevision"), int):
            return _err(400, "bad_input", "Потрібен ifRevision.")
        if body["ifRevision"] != d["revision"]:
            return _err(409, "revision_conflict",
                        f"Чернетку змінено з іншого пристрою (ревізія {d['revision']}, у вас {body['ifRevision']}). "
                        "Оновіть і повторіть правку.")
        bad = self._check_instruction_fields(d["kind"], body) or self._check_book_fields(d["kind"], body, d)
        if bad:
            return bad
        for f in ("title", "craft", "audience", "level", "instructionMode", "modelCode", "bookId", "newBookTitle"):
            if f in body:
                d[f] = body[f]
        if "photoOrder" in body:
            ids = body["photoOrder"]
            if not isinstance(ids, list) or sorted(ids) != sorted(p["photoId"] for p in d["photos"]):
                return _err(400, "bad_input", "photoOrder має містити всі кадри.")
            for i, pid in enumerate(ids, 1):
                self._photo(d, pid)["order"] = i  # type: ignore[index]
        if "lessons" in body or "assumptions" in body or "structure" in body:
            if d["kind"] == "manuscript":
                return _err(409, "wrong_status", "У рукописі структури немає.")
        if "structure" in body:
            bad = self._replace_structure(d, body["structure"])
            if bad:
                return bad
        for patch in body.get("lessons", []) or []:
            les = next((x for m in (d["structure"] or {"modules": []})["modules"] for x in m["lessons"]
                        if x["lessonId"] == patch.get("lessonId")), None)
            if les is None:
                return _err(400, "bad_input", "Невідомий lessonId.")
            for f in ("title", "goal", "body", "topics"):
                if f in patch:
                    les[f] = patch[f]
                    if f in les["aiFields"]:
                        les["aiFields"].remove(f)
        for patch in body.get("assumptions", []) or []:
            a = next((x for x in d["assumptions"] if x["assumptionId"] == patch.get("assumptionId")), None)
            if a is None or patch.get("status") not in {"open", "confirmed", "rejected"}:
                return _err(400, "bad_input", "Невалідне припущення.")
            a["status"] = patch["status"]
        self._bump(d)
        return 200, {"draft": copy.deepcopy(d)}

    def _add_photo(self, d: dict[str, Any], body: Any) -> Result:
        if d["status"] == "submitted":
            return _err(409, "wrong_status", "Чернетку вже відправлено.")
        key = (d["draftId"], body["clientId"])
        if key in self.clients:
            p = self._photo(d, self.clients[key])
            if p:
                return 202, {"photo": copy.deepcopy(p), "revision": d["revision"], "duplicate": True}
        cap = self.limits["maxManuscriptPages"] if d["kind"] == "manuscript" else self.limits["maxPhotosPerDraft"]
        if len(d["photos"]) >= cap:
            return _err(409, "too_many_photos", "Забагато кадрів.")
        pid = self._next("ph")
        order = len(d["photos"]) + 1
        p = {"photoId": pid, "clientId": body["clientId"], "status": "processing", "order": order,
             "takenAt": body.get("takenAt"), "imageUrl": self._image_url(d["draftId"], pid), "description": None,
             "tags": [], "error": None, "createdAt": _now(), "updatedAt": _now()}
        if d["kind"] == "manuscript":
            p["text"], p["textEdited"] = None, False
        d["photos"].append(p)
        self.clients[key] = pid
        img = body.get("image", "")
        try:
            self.images[(d["draftId"], pid)] = base64.b64decode(img.split(",", 1)[1] if img.startswith("data:") else img)
        except (ValueError, binascii.Error):  # pragma: no cover  (форму вже перевірив мок)
            pass
        if body.get("note"):
            d["notes"].append({"noteId": f"n-{pid}", "photoIds": [pid], "text": body["note"], "updatedAt": _now()})
        if d["status"] in {"structured", "written"}:
            d["status"] = "collecting"
        self._bump(d)
        return 202, {"photo": copy.deepcopy(p), "revision": d["revision"], "duplicate": False}

    def _put_text(self, d: dict[str, Any], photo_id: str, body: Any) -> Result:
        if d["kind"] != "manuscript":
            return _err(409, "wrong_status", "Текст сторінки — лише для рукопису.")
        p = self._photo(d, photo_id)
        if p is None:
            return _err(404, "photo_not_found", "Кадру немає в цій чернетці.")
        if p["status"] == "processing":
            return _err(409, "wrong_status", "Сторінка ще розпізнається.")
        if not isinstance(body, dict) or not isinstance(body.get("text"), str) \
                or len(body["text"]) > self.limits["maxPageTextChars"]:
            return _err(400, "bad_input", "Потрібен text (рядок у межах maxPageTextChars).")
        p.update(text=body["text"], textEdited=True, status="described", error=None, updatedAt=_now())
        self._bump(d)
        return 200, {"photo": copy.deepcopy(p), "revision": d["revision"], "duplicate": False}

    def _put_note(self, d: dict[str, Any], note_id: str, body: Any) -> Result:
        if not isinstance(body, dict) or not isinstance(body.get("text"), str) or not isinstance(body.get("photoIds"), list):
            return _err(400, "bad_input", "Потрібні photoIds і text.")
        if contract.count_note_chars(body["text"]) > self.limits["maxNoteChars"]:
            return _err(400, "note_too_long", "Опис понад 500 символів.")
        for pid in body["photoIds"]:
            if self._photo(d, pid) is None:
                return _err(404, "photo_not_found", "Кадру немає в цій чернетці.")
        n = next((n for n in d["notes"] if n["noteId"] == note_id), None)
        if n is None:
            n = {"noteId": note_id, "photoIds": [], "text": "", "updatedAt": ""}
            d["notes"].append(n)
        n.update(photoIds=body["photoIds"], text=body["text"], updatedAt=_now())
        self._bump(d)
        return 200, {"note": copy.deepcopy(n), "revision": d["revision"]}

    def _structure(self, d: dict[str, Any], body: Any) -> Result:
        if d["kind"] == "manuscript":
            return _err(409, "wrong_status", "Для рукопису проходів 2–3 немає.")
        if d["job"] and d["job"]["status"] == "running":
            return _err(409, "job_running", "Уже виконується фонова робота.")
        if not d["photos"] or any(p["status"] == "processing" for p in d["photos"]):
            return _err(409, "wrong_status", "Кадрів немає або вони ще описуються.")
        replace = bool(isinstance(body, dict) and body.get("replace"))
        if d["structure"] and not replace:
            return _err(409, "wrong_status", "Структура вже є: передайте replace: true.")
        d["structure"], d["assumptions"] = None, []
        d["job"] = {"kind": "structure", "status": "running", "moduleId": None, "error": None, "startedAt": _now()}
        self.ticks[d["draftId"]] = STRUCTURE_TICKS
        return 202, {"draft": copy.deepcopy(d)}

    def _generate(self, d: dict[str, Any], module_id: str) -> Result:
        if d["job"] and d["job"]["status"] == "running":
            return _err(409, "job_running", "Уже виконується фонова робота.")
        if not d["structure"]:
            return _err(409, "wrong_status", "Спершу розкладіть кадри на уроки.")
        if not any(m["moduleId"] == module_id for m in d["structure"]["modules"]):
            return _err(404, "module_not_found", "Модуля немає в структурі.")
        d["job"] = {"kind": "generate", "status": "running", "moduleId": module_id, "error": None, "startedAt": _now()}
        self.ticks[d["draftId"]] = GENERATE_TICKS
        return 202, {"draft": copy.deepcopy(d)}

    def blockers(self, d: dict[str, Any]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        if not d["photos"]:
            out.append({"kind": "no_photos", "message": "Додайте хоч один кадр."})
        if any(p["status"] == "processing" for p in d["photos"]):
            out.append({"kind": "photos_processing", "message": "Кадри ще описуються."})
        for p in d["photos"]:
            if p["status"] == "failed":
                out.append({"kind": "photos_failed", "message": f"Кадр {p['order']} не описано.", "photoId": p["photoId"]})
        if d["kind"] == "manuscript":
            for p in d["photos"]:
                if p["status"] == "described" and not (p.get("text") or "").strip():
                    out.append({"kind": "empty_page", "photoId": p["photoId"],
                                "message": f"На сторінці {p['order']} немає тексту — введіть вручну або приберіть сторінку."})
            if not (d["title"] or "").strip():
                out.append({"kind": "title_missing", "message": "Дайте главі назву."})
            if not d["bookId"] and not d["newBookTitle"]:
                out.append({"kind": "book_missing", "message": "Оберіть книгу або вкажіть назву нової."})
            return out
        if not d["structure"] or d["status"] == "collecting":
            out.append({"kind": "no_structure", "message": "Спершу натисніть «Розкласти на уроки»."})
            return out
        for m in d["structure"]["modules"]:
            if not m["written"]:
                out.append({"kind": "module_not_written", "moduleId": m["moduleId"],
                            "message": f"Модуль «{m['title']}» ще без тексту — натисніть «Написати курс»."})
            for les in m["lessons"]:
                if m["written"] and not (les.get("body") or "").strip():
                    out.append({"kind": "empty_lesson", "lessonId": les["lessonId"], "moduleId": m["moduleId"],
                                "message": f"Урок «{les['title']}» порожній."})
        for a in d["assumptions"]:
            if a["status"] == "open":
                out.append({"kind": "open_assumptions", "assumptionId": a["assumptionId"],
                            "message": f"Підтвердіть припущення: «{a['text']}»."})
        if not (d["title"] or "").strip():
            out.append({"kind": "title_missing", "message": "Дайте чернетці назву."})
        return out

    def _submit(self, d: dict[str, Any]) -> Result:
        if d["status"] == "submitted":
            return _err(409, "wrong_status", "Чернетку вже відправлено.")
        if d["job"] and d["job"]["status"] == "running":
            return _err(409, "job_running", "Уже виконується фонова робота.")
        bl = self.blockers(d)
        if bl:
            return _err(400, "submit_blocked", "Чернетка ще не готова до відправки.", blockers=bl)
        if d["kind"] == "manuscript":
            tid = self._next("scn")
            url = "/media?tab=inbox" + (f"&bookId={d['bookId']}" if d["bookId"] else "")
            target = {"kind": "inbox", "id": tid, "studioUrl": url}
            d["status"], d["submitted"] = "submitted", target
            self._bump(d)
            return 201, {"draft": copy.deepcopy(d), "target": target}
        fx = {"course": "submit-course", "instruction": "submit-instruction"}.get(d["kind"], "submit-course")
        target = contract.load_fixture(fx)["target"]
        target = {**target, "id": self._next("crs" if target["kind"] == "course" else "exp")}
        target["studioUrl"] = ("/courses/" if target["kind"] == "course" else "/express/") + target["id"]
        d["status"], d["submitted"] = "submitted", target
        self._bump(d)
        return 201, {"draft": copy.deepcopy(d), "target": target}

"""Типи відповідей Studio. Толерантні: невідомі поля ігноруються (контракт §1, «Сумісність»)."""
from __future__ import annotations

from dataclasses import dataclass, field, fields
from typing import Any, TypeVar

T = TypeVar("T")


def _build(cls: type[T], d: dict[str, Any], **nested: Any) -> T:
    names = {f.name for f in fields(cls)}  # type: ignore[arg-type]
    kwargs = {k: v for k, v in d.items() if k in names}
    kwargs.update(nested)
    return cls(**kwargs)


@dataclass
class Photo:
    photoId: str
    clientId: str
    status: str  # processing | described | failed
    order: int
    imageUrl: str
    takenAt: str | None = None
    description: str | None = None
    tags: list[str] = field(default_factory=list)
    error: str | None = None
    createdAt: str = ""
    updatedAt: str = ""
    text: str | None = None  # лише рукопис
    textEdited: bool = False

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Photo":
        return _build(cls, d)


@dataclass
class Note:
    noteId: str
    photoIds: list[str]
    text: str
    updatedAt: str = ""

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Note":
        return _build(cls, d)


@dataclass
class Lesson:
    lessonId: str
    title: str
    goal: str | None = None
    photoIds: list[str] = field(default_factory=list)
    body: str | None = None
    topics: list[str] = field(default_factory=list)
    aiFields: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Lesson":
        return _build(cls, d)


@dataclass
class Module:
    moduleId: str
    title: str
    summary: str | None = None
    lessons: list[Lesson] = field(default_factory=list)
    written: bool = False

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Module":
        return _build(cls, d, lessons=[Lesson.from_dict(x) for x in d.get("lessons", [])])


@dataclass
class Structure:
    modules: list[Module] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Structure":
        return cls(modules=[Module.from_dict(x) for x in d.get("modules", [])])


@dataclass
class Assumption:
    assumptionId: str
    text: str
    status: str  # open | confirmed | rejected
    moduleId: str | None = None
    lessonId: str | None = None
    photoId: str | None = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Assumption":
        return _build(cls, d)


@dataclass
class Job:
    kind: str  # structure | generate
    status: str  # running | failed
    moduleId: str | None = None
    error: str | None = None
    startedAt: str = ""

    @property
    def running(self) -> bool:
        return self.status == "running"

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Job":
        return _build(cls, d)


@dataclass
class Target:
    kind: str  # course | express | inbox
    id: str
    studioUrl: str  # відносний шлях у Studio

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Target":
        return _build(cls, d)


@dataclass
class Draft:
    draftId: str
    kind: str  # course | instruction | book | manuscript
    status: str  # collecting | structured | written | submitted | discarded
    revision: int
    title: str | None = None
    craft: str | None = None
    audience: str | None = None
    level: str | None = None
    bookId: str | None = None
    photos: list[Photo] = field(default_factory=list)
    notes: list[Note] = field(default_factory=list)
    structure: Structure | None = None
    assumptions: list[Assumption] = field(default_factory=list)
    job: Job | None = None
    submitted: Target | None = None
    createdAt: str = ""
    updatedAt: str = ""
    instructionMode: str | None = None
    modelCode: str | None = None
    newBookTitle: str | None = None
    courseSource: str | None = None  # лише курс (контракт 1.6.0): photos | document

    @property
    def textPages(self) -> bool:
        """Кадри — сторінки тексту: розпізнаються дослівно (`text`), а не описуються."""
        return self.kind == "manuscript" or (self.kind == "course" and self.courseSource == "document")

    @property
    def busy(self) -> bool:
        """Є що опитувати: фото в processing або робота running."""
        return any(p.status == "processing" for p in self.photos) or bool(self.job and self.job.running)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Draft":
        return _build(
            cls, d,
            photos=[Photo.from_dict(x) for x in d.get("photos", [])],
            notes=[Note.from_dict(x) for x in d.get("notes", [])],
            structure=Structure.from_dict(d["structure"]) if d.get("structure") else None,
            assumptions=[Assumption.from_dict(x) for x in d.get("assumptions", [])],
            job=Job.from_dict(d["job"]) if d.get("job") else None,
            submitted=Target.from_dict(d["submitted"]) if d.get("submitted") else None,
        )


@dataclass
class DraftSummary:
    draftId: str
    kind: str
    status: str
    title: str | None = None
    photoCount: int = 0
    updatedAt: str = ""
    courseSource: str | None = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "DraftSummary":
        return _build(cls, d)


@dataclass
class Limits:
    maxNoteChars: int = 500
    maxImageBytes: int = 10 * 1024 * 1024
    recommendedMaxSidePx: int = 2048
    maxPhotosPerDraft: int = 300
    photosPerHour: int = 120
    maxOpenDrafts: int = 20
    maxTitleChars: int = 160
    maxShortFieldChars: int = 200
    maxLessonBodyChars: int = 20000
    pollIntervalMs: int = 2000
    maxManuscriptPages: int = 120
    manuscriptPagesPerHour: int = 200
    maxPageTextChars: int = 20000

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Limits":
        return _build(cls, d)


@dataclass
class PassCredits:
    expected: int
    max: int


@dataclass
class PassModelOption:
    """Модель для проходів 2–3 (контракт 1.4.0). `usable` — її можна обрати; `credits` — бали за прохід."""
    modelId: str
    label: str
    provider: str
    status: str  # ok | busy | no_key | key_rejected | no_funds | model_missing | price_unknown
    usable: bool
    note: str | None = None
    credits: PassCredits | None = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "PassModelOption":
        cr = d.get("credits")
        return _build(cls, d, credits=PassCredits(int(cr["expected"]), int(cr["max"])) if cr else None)


@dataclass
class AiOptions:
    """Відповідь `GET …/ai-options`: що можна обрати й скільки це коштує в балах."""
    pass_name: str  # у JSON — "pass"
    moduleId: str | None
    defaultModelId: str | None
    models: list[PassModelOption]
    balance: int | None
    unlimited: bool
    checkedAt: str

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "AiOptions":
        return cls(
            pass_name=d["pass"], moduleId=d.get("moduleId"), defaultModelId=d.get("defaultModelId"),
            models=[PassModelOption.from_dict(m) for m in d.get("models", [])],
            balance=d.get("balance"), unlimited=bool(d.get("unlimited")), checkedAt=d.get("checkedAt", ""))


@dataclass
class PhotoResult:
    photo: Photo
    revision: int
    duplicate: bool = False


@dataclass
class NoteResult:
    note: Note
    revision: int


@dataclass
class SubmitResult:
    draft: Draft
    target: Target

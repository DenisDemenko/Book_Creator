-- 0013 · Т2.4 В3 — риса «вік» іде з версії зовнішності
-- (PLAN_CONTINUITY.md §2, §3 В3).

-- Версія зовнішності (Т2.3 В3, `appearance_versions.age`) автоматично живить
-- рису з міткою «вік» (`entity_traits`, В1) — щоб `trait_contradiction`
-- (В3) ловила суперечності віку тим самим універсальним правилом, що й
-- вільний опис (В5), без дублювання даних. Зв'язок з версією — щоб під час
-- редагування/видалення версії похідна риса оновлювалась чи зникала, а не
-- лишала застарілий чи осиротілий запис; версію видалено — риса зникає
-- разом з нею (ON DELETE CASCADE, а не SET NULL, як у `asset_entity_links`:
-- рисі без версії, з якої вона зроблена, нема звідки взяти значення).
ALTER TABLE entity_traits
  ADD COLUMN appearance_version_id uuid REFERENCES appearance_versions(id) ON DELETE CASCADE;
CREATE INDEX entity_traits_version_idx ON entity_traits (appearance_version_id) WHERE appearance_version_id IS NOT NULL;

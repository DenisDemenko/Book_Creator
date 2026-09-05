import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { PX_PER_MM } from '../../utils/mmUnits';
import { computeBreaksFromBounds, type BlockBounds } from '../../utils/pageBreaker';

export interface PaginationOptions {
  /** Висота текстового блоку сторінки (мм) — формат мінус верхнє/нижнє поле. */
  getPageContentHeightMm: () => number;
  /** Верхнє й нижнє поле (мм) — визначає висоту "розриву" між аркушами на екрані. */
  getVerticalMarginsMm: () => { topMm: number; bottomMm: number };
  /**
   * Реальний номер першої сторінки поточного розділу в межах усієї книги
   * (не «сторінка 1» умовно від початку розділу) — з useRealBookPages.ts в
   * EditorView.tsx. Опційно: якщо не задано, нумерація лишається умовною
   * від 1 (використовується для англійського редактора — рахувати другий
   * повний прохід по всій книзі для нього поки не варте додаткової ваги).
   */
  getStartPageNumber?: () => number;
  /**
   * Назва й номер глави ("Розділ N: Назва") для бордового колонтитула,
   * що повторюється зверху кожного аркуша — той самий підпис, який над
   * текстом видно й в шапці модуля, але тут він друкується прямо НА
   * сторінці, як у звичайній книзі. Необов'язковий: без нього колонтитул
   * просто не малюється (сумісність зі старими викликами плагіна).
   */
  getRunningHeaderText?: () => string;
}

const paginationKey = new PluginKey('novaPagination');

/** Малює "розрив між аркушами" — суцільна смуга кольору полотна на всю ширину вікна (не лише колонки сторінки), фіксованої висоти 15px. */
function buildGapWidget(pageNumber: number): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'false');
  // Мітка для measure(): перед вимірюванням розриви ховаються, щоб
  // плагін не міряв розкладку, яку сам же й спотворив (див. measure).
  el.setAttribute('data-nova-pagebreak', '');
  el.style.cssText = `
    width: 100vw;
    margin-left: calc(-50vw + 50%);
    height: 15px;
    background: #0f172a;
    flex-direction: column;
    gap: 2px;
    /* Обтічне зображення інакше звисає з попереднього аркуша на
       наступний: float виходить з потоку, і смуга розриву просто
       обтікала б його збоку замість того, щоб закрити сторінку. */
    clear: both;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    pointer-events: none;
    user-select: none;
  `;
  // Лише номер сторінки. Бордовий колонтитул глави з розриву прибрано:
  // у смузі заввишки 15px він не вміщається, а обрізаний наполовину рядок
  // читався б як дефект верстки. Колонтитул першого аркуша лишається
  // статичним блоком у EditorView.tsx.
  const label = document.createElement('span');
  label.textContent = `— ${pageNumber} —`;
  label.style.cssText = 'font-size: 10px; color: #64748b; font-family: monospace;';
  el.appendChild(label);
  return el;
}

/**
 * Живі розриви сторінок у редакторі — вимірює реальну відрендерену
 * висоту кожного блоку тексту (абзац/цитата/картинка) й малює декорацію
 * "розрив між аркушами" там, де вміст перестає влазити у формат сторінки
 * книги. Алгоритм розбиття — computeBreaks в utils/pageBreaker.ts, спільний
 * з майбутньою реальною пагінацією «Розворот книги».
 *
 * Один документ ProseMirror лишається безперервним (курсор/виділення/undo
 * не ускладнюються) — розриви це лише візуальні декорації, що не
 * впливають на сам текст чи на те, як він зберігається/експортується.
 */
export const PaginationPlugin = Extension.create<PaginationOptions>({
  name: 'novaPagination',

  addOptions() {
    return {
      getPageContentHeightMm: () => 220,
      getVerticalMarginsMm: () => ({ topMm: 20, bottomMm: 20 }),
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => {
            const meta = tr.getMeta(paginationKey);
            if (meta) return meta as DecorationSet;
            return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
          },
        },
        props: {
          decorations(state) {
            return paginationKey.getState(state);
          },
        },
        view(editorView) {
          let timer: ReturnType<typeof setTimeout> | null = null;
          let destroyed = false;

          const measure = () => {
            if (destroyed) return;
            const { state } = editorView;
            const pageContentHeightPx = options.getPageContentHeightMm() * PX_PER_MM;
            if (!(pageContentHeightPx > 0)) return;

            // Розриви попереднього проходу ХОВАЄМО на час вимірювання.
            // Вони самі є блоками в потоці й мають `clear: both`, тож
            // абзац одразу за розривом уже не може стати поруч із
            // обтічним фото — вимір «бачив» би розкладку, зіпсовану
            // попереднім же розбиттям, і розриви повзли б від проходу до
            // проходу (те саме «перестрибування» тексту, лише повільніше).
            // Міряти треба ЧИСТИЙ потік, без власних декорацій.
            const gapWidgets = Array.from(
              editorView.dom.querySelectorAll<HTMLElement>('[data-nova-pagebreak]')
            );
            gapWidgets.forEach((w) => {
              w.style.display = 'none';
            });

            const bounds: BlockBounds[] = [];
            const keepWithNext: boolean[] = [];
            const positions: number[] = [];
            state.doc.forEach((_node, offset) => {
              const dom = editorView.nodeDOM(offset) as HTMLElement | null;
              // offsetTop/offsetHeight, НЕ getBoundingClientRect(): PageColumn.tsx
              // масштабує сторінку через CSS transform:scale(), коли панель
              // вужча за фізичну ширину сторінки (типово в докованому
              // редакторі). getBoundingClientRect() повертає ВІЗУАЛЬНИЙ
              // (уже масштабований) розмір, а pageContentHeightPx нижче —
              // завжди фізичний, немасштабований. Порівняння цих двох
              // призводило до розривів сторінок у неправильних місцях
              // (видимі "стрибки" тексту й порожні прогалини) — offsetTop
              // читає позицію ДО трансформації, ту саму, що й фізичний вимір.
              //
              // Міряємо саме МЕЖІ, а не висоту кожного блоку окремо:
              // обтічна (float) картинка ділить вертикаль із абзацами, що
              // її обтікають, тож сума власних висот завищувала б заповнення
              // сторінки. Деталі — computeBreaksFromBounds в utils/pageBreaker.ts.
              const top = dom ? dom.offsetTop : 0;
              bounds.push({ top, bottom: top + (dom ? dom.offsetHeight : 0) });
              // Обтічне фото не має лишатися останнім на сторінці — інакше
              // абзац, який автор поставив в обтікання, поїде на наступний
              // аркуш, а поруч із картинкою лишиться порожнє місце.
              keepWithNext.push(!!dom && getComputedStyle(dom).float !== 'none');
              positions.push(offset);
            });

            gapWidgets.forEach((w) => {
              w.style.display = '';
            });

            const breakIndices = computeBreaksFromBounds(bounds, pageContentHeightPx, keepWithNext);
            const startPage = options.getStartPageNumber ? options.getStartPageNumber() : 1;
            const decorations = breakIndices.map((i, n) =>
              Decoration.widget(
                positions[i],
                () => buildGapWidget(startPage + n + 1),
                { side: -1, key: `nova-pagebreak-${i}` }
              )
            );

            const next = DecorationSet.create(editorView.state.doc, decorations);
            const tr = editorView.state.tr.setMeta(paginationKey, next);
            editorView.dispatch(tr);
          };

          const schedule = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(measure, 200);
          };

          schedule();

          return {
            // Лише коли ЗМІНИВСЯ САМ ДОКУМЕНТ (реальне редагування), а НЕ
            // на кожен update() узагалі — bez цієї перевірки власна
            // транзакція measure() (editorView.dispatch(tr) нижче, лише
            // setMeta декорацій, doc той самий) теж викликає update(),
            // schedule() планує НАСТУПНИЙ вимір, той знову дописує
            // транзакцію — і так нескінченно, кожні 200мс, назавжди, навіть
            // без жодної реальної зміни тексту. DecorationSet при цьому
            // щоразу повністю замінюється (state.apply просто повертає
            // meta), тож ProseMirror не може ефективно звірити старий/новий
            // набір — DOM віджета розриву сторінки знищується й
            // перестворюється щоцикл. Саме це й спричиняло видиме
            // «блимання» тексту поруч із обтічним (float) зображенням —
            // де перестворення DOM найпомітніше зачіпає розкладку.
            update: (view, prevState) => {
              if (view.state.doc !== prevState.doc) schedule();
            },
            destroy: () => {
              destroyed = true;
              if (timer) clearTimeout(timer);
            },
          };
        },
      }),
    ];
  },
});

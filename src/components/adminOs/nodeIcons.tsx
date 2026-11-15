/**
 * Емблема вузла адмінпанелі.
 *
 * НАВІЩО. На карті двадцять один вузол, і всі вони виглядали однаково:
 * ціанова пігулка з рядком великих літер. Щоб знайти потрібний, доводилось
 * читати всі назви підряд — очі не мали за що зачепитися. Прохання власника
 * 15.11.2026: поставити перед назвою знак, за яким розділ упізнається
 * швидше, ніж прочитується.
 *
 * ЧОМУ ОКРЕМИЙ ФАЙЛ. `nodes.ts` — чистий реєстр даних, без React. Іконка ж
 * це компонент, і тягнути його в реєстр означало б тягнути туди й усю
 * бібліотеку. Тут відповідність «id вузла → іконка» лежить поруч, а
 * `iconForNode` ніколи не повертає порожнечу: новий вузол без своєї іконки
 * дістає загальну, а не діру в пігулці.
 */

import React from 'react';
import {
  Banknote,
  BookOpen,
  Boxes,
  Brain,
  CircleDot,
  ClipboardCheck,
  Coins,
  Columns3,
  Cpu,
  Database,
  GitCommitHorizontal,
  HandCoins,
  KeyRound,
  LineChart,
  MessageSquareHeart,
  Package,
  PiggyBank,
  Server,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Trees,
  Users,
  Workflow,
} from 'lucide-react';

export type NodeIcon = React.ComponentType<{ className?: string }>;

const ICONS: Record<string, NodeIcon> = {
  // Ядро
  providers: KeyRound,
  prompts: Brain,
  pricing: Coins,
  costs: Banknote,
  expenses: PiggyBank,
  business: LineChart,
  users: Users,
  roles: ShieldCheck,
  crm: MessageSquareHeart,
  quality: Sparkles,
  'graph-studio': Workflow,
  git: GitCommitHorizontal,

  // Операції
  bridge: Store,
  products: Package,
  moderation: ClipboardCheck,
  'price-management': Cpu,
  procurement: HandCoins,
  'private-stores': Server,
  'slab-tables': Trees,
  'cabinet-facades': Columns3,
  crowdfunding: Boxes,

  // Трапляються в інших переліках адмінки
  books: BookOpen,
  listings: ShoppingBag,
  keys: KeyRound,
  usage: Database,
};

/** Іконка вузла; невідомий id дістає нейтральний знак, а не порожнє місце. */
export function iconForNode(id: string): NodeIcon {
  return ICONS[id] ?? CircleDot;
}

/** Чи має вузол власну емблему (а не загальну). Для перевірок. */
export function hasOwnIcon(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICONS, id);
}

import type { LabyrinthEventTemplate } from "./labyrinth";
export const MECHANIC_KINDS = [
  "bridge_block",
  "falling_hazard",
  "drawbridge",
  "false_route",
  "crossfire",
  "ambush",
  "flood",
  "barrier",
] as const;
export type MechanicKind = (typeof MECHANIC_KINDS)[number];
export const MECHANIC_LIBRARY: Record<
  MechanicKind,
  {
    title: string;
    description: string;
    warning: string;
    response: string;
    resolved: string;
  }
> = {
  bridge_block: {
    title: "Обвал / блокування мосту",
    description:
      "Решітка тимчасово перекриває міст; нижній обхід і важіль залишаються варіантами відповіді.",
    warning: "У настилі чути тріск, решітка починає опускатися.",
    response: "Розблокувати міст нижнім важелем",
    resolved: "Важіль зупинив блокування мосту.",
  },
  falling_hazard: {
    title: "Уламки / смола згори",
    description:
      "Небезпека з мосту діє лише на пов’язані нижні коридори. Укриття захищає від падіння.",
    warning: "З мосту сиплеться пил; угорі хитаються уламки.",
    response: "Вимкнути джерело падіння",
    resolved: "Джерело падіння зупинено.",
  },
  drawbridge: {
    title: "Підйомний міст",
    description:
      "Міст піднімається й змушує змінити маршрут або повернути його нижнім механізмом.",
    warning: "Ланцюги натягуються, секція мосту починає підійматися.",
    response: "Опустити міст нижнім механізмом",
    resolved: "Механізм опустив міст.",
  },
  false_route: {
    title: "Ілюзія безпечного маршруту",
    description:
      "Безпека є хибною підказкою, а не фактом карти. Ознаки обману можна дослідити до пастки.",
    warning: "Стрілка підсвічує міст, але під настилом чути металевий брязкіт.",
    response: "Дослідити ознаки хибної підказки",
    resolved: "Ознаки перевірено; пастку обійдено, хибну підказку викрито.",
  },
  crossfire: {
    title: "Перехресний вогонь згори",
    description:
      "Небезпека з верхнього мосту загрожує відкритим нижнім вузлам; укриття і відволікання дають відповідь.",
    warning: "На мосту видно рух стрільців і світлові відблиски.",
    response: "Відволікти стрільців із нижнього рівня",
    resolved: "Стрільців відволікли, обстріл припинився.",
  },
  ambush: {
    title: "Засада згори",
    description:
      "Засідка з мосту блокує вхід у пов’язані нижні вузли; герой може відступити чи вимкнути приманку.",
    warning: "На мосту скрегочуть кігті; тіні збираються над коридором.",
    response: "Знешкодити приманку засади",
    resolved: "Приманку знешкоджено; засаду розсіяно.",
  },
  flood: {
    title: "Газ / вода внизу",
    description:
      "Шкода наростає за кроками; реальні сходи, драбина або підйомник ведуть нагору.",
    warning: "У нижньому коридорі чути шипіння; вода або туман підіймаються.",
    response: "Перекрити подачу газу / води",
    resolved: "Подачу перекрито, небезпека припинилася.",
  },
  barrier: {
    title: "Бар’єр із генератором унизу",
    description:
      "Вихід мостом залежить від нижнього генератора; його вимкнення знімає поле.",
    warning: "Вихід мосту мерехтить; унизу чути запуск генератора.",
    response: "Вимкнути нижній генератор бар’єра",
    resolved: "Генератор вимкнено, поле на мосту зникло.",
  },
};
export interface MechanicBinding {
  id: string;
  kind: MechanicKind;
  bridgeId: string;
  responseNodeId: string;
  preparation: number;
  duration: number;
  cooldown: number;
  damage: number;
}
export function mechanicTitle(event: LabyrinthEventTemplate) {
  return event.mechanic
    ? MECHANIC_LIBRARY[event.mechanic.kind].title
    : event.id;
}

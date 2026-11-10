/**
 * Фонові обслуговуючі задачі Studio, що не належать жодному маршруту (журнал #538):
 *  - повернення покинутих резервів балів (процес упав між резервом і списанням — creditGate);
 *  - автоматичні копії бази (dbBackup).
 * Запускається один раз після `server.listen`. Усі таймери `unref` — не тримають процес живим.
 */

import { sweepStaleReservations } from './creditGate';
import { startBackupSchedule } from './dbBackup';

const SWEEP_EVERY_MS = 10 * 60_000;
/** Перший прохід — не одразу: база могла ще не відкритись, а минулий процес міг лишити резерви ще свіжими. */
const SWEEP_FIRST_DELAY_MS = 30_000;

export function startMaintenance(): void {
  const first = setTimeout(() => sweepStaleReservations(), SWEEP_FIRST_DELAY_MS);
  first.unref();
  const every = setInterval(() => sweepStaleReservations(), SWEEP_EVERY_MS);
  every.unref();
  startBackupSchedule();
}

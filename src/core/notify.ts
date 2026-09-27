/**
 * Player-facing messages. notify() stores the message in state.notifications
 * (player's and global ones only) and emits 'notify' so the UI shows a toast.
 */
import { MAX_NOTIFICATIONS } from './constants';
import type { GameContext } from './context';
import type { CompanyId, EntityRef, NotificationLevel } from './types';
import { newId } from './util';

export interface NotifyOptions {
  level?: NotificationLevel;
  title: string;
  text?: string;
  icon?: string;
  target?: EntityRef | null;
  /** Concerned company (0 = everyone). Messages for AI companies are dropped. */
  companyId?: CompanyId;
  /** Filter category: production | logistics | finance | city | event | research | goal | ai | system */
  category?: string;
  /** Do not show a toast, only log. */
  silent?: boolean;
}

const LEVEL_ICON: Record<NotificationLevel, string> = { info: 'ℹ️', success: '✅', warning: '⚠️', danger: '⛔' };

export function notify(ctx: GameContext, o: NotifyOptions): void {
  const st = ctx.tryState();
  const companyId = o.companyId ?? 0;
  if (st && companyId !== 0 && companyId !== st.playerCompanyId) return;
  const level = o.level ?? 'info';
  const icon = o.icon ?? LEVEL_ICON[level];
  const text = o.text ?? '';
  const target = o.target ?? null;
  if (st) {
    const list = st.notifications.list;
    list.push({
      id: newId(st, 'notification'),
      day: st.time.totalDays,
      level,
      title: o.title,
      text,
      icon,
      target,
      companyId,
      read: false,
      category: o.category ?? 'system',
    });
    if (list.length > MAX_NOTIFICATIONS) list.splice(0, list.length - MAX_NOTIFICATIONS);
  }
  if (!o.silent) ctx.bus.emit('notify', { level, title: o.title, text, icon, target, companyId });
}

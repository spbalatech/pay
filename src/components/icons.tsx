/**
 * One place that decides which icon means what, so an agent, a status or a
 * warning sign looks the same everywhere it appears. Icons always sit beside
 * a word, never replace it, and are hidden from screen readers so the word is
 * not announced twice.
 */
import {
  AlarmClock,
  BadgeDollarSign,
  BookOpenCheck,
  CalendarX,
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  Eye,
  Hand,
  History,
  Hourglass,
  LayoutDashboard,
  Lightbulb,
  PackageSearch,
  Radar,
  Repeat,
  Scale,
  SearchCheck,
  ShieldHalf,
  Swords,
  Trophy,
  Truck,
  Undo2,
  User,
  type LucideIcon,
} from "lucide-react";

export function Icon({ as: I, size = 16, className }: { as: LucideIcon; size?: number; className?: string }) {
  return <I size={size} strokeWidth={2} aria-hidden focusable={false} className={`icon ${className ?? ""}`} />;
}

/** The four agents (and the human operator), used in the feed, loop and headings. */
export const AGENT_ICON: Record<string, LucideIcon> = {
  Sentinel: ShieldHalf,
  Interceptor: Radar,
  Advocate: Scale,
  Learner: Lightbulb,
  You: User,
};

export const NAV_ICON: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/orders": ShieldHalf,
  "/watchlist": Radar,
  "/disputes": Scale,
  "/rulebook": BookOpenCheck,
  "/audit": History,
};

/** Interceptor's warning signs. */
export const WARNING_ICON: Record<string, LucideIcon> = {
  STALLED_TRACKING: Truck,
  PAST_PROMISE_DATE: CalendarX,
  NO_TRACKING: PackageSearch,
  DORMANT_RENEWAL: Repeat,
  DUPLICATE_CHARGE: Copy,
  SILENT_HIGH_VALUE: BadgeDollarSign,
};

/** Badge values: tiers, recommendations, dispute status, deadlines. */
export const BADGE_ICON: Record<string, LucideIcon> = {
  HOLD: Hand,
  REVIEW: Eye,
  CLEAR: CircleCheck,
  FIGHT: Swords,
  ACCEPT: Undo2,
  VERIFY: SearchCheck,
  SHIP: Truck,
  OPEN: Clock,
  WON: Trophy,
  LOST: CircleX,
  ACCEPTED: Undo2,
  WITH_PAYPAL: Hourglass,
  OVERDUE: AlarmClock,
  DUE_SOON: Hourglass,
};

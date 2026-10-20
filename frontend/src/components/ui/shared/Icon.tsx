import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Building2,
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Flag,
  Funnel,
  Globe,
  Info,
  Key,
  Layers,
  LayoutGrid,
  Link,
  List,
  Loader,
  LocateFixed,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Minus,
  Move,
  PenLine,
  Plus,
  RefreshCw,
  Repeat,
  Rss,
  Search,
  Send,
  Shield,
  SlidersVertical,
  Smartphone,
  Smile,
  SquareCheckBig,
  Tag,
  Trash2,
  TriangleAlert,
  Unlink,
  Upload,
  User,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

/** Design glyph names (Icon.dc.html / IconSheet.dc.html) mapped to lucide-react icons. */
export const GLYPHS = {
  calendar: Calendar,
  "calendar-days": CalendarDays,
  plus: Plus,
  minus: Minus,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  "chevrons-up-down": ChevronsUpDown,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  x: X,
  check: Check,
  search: Search,
  trash: Trash2,
  edit: PenLine,
  copy: Copy,
  "map-pin": MapPin,
  locate: LocateFixed,
  users: Users,
  user: User,
  "user-plus": UserPlus,
  sliders: SlidersVertical,
  list: List,
  upload: Upload,
  download: Download,
  rss: Rss,
  link: Link,
  unlink: Unlink,
  eye: Eye,
  "eye-off": EyeOff,
  lock: Lock,
  globe: Globe,
  alert: TriangleAlert,
  info: Info,
  "check-circle": CircleCheck,
  "x-circle": CircleX,
  menu: Menu,
  more: Ellipsis,
  "log-out": LogOut,
  key: Key,
  clock: Clock,
  archive: Archive,
  refresh: RefreshCw,
  flag: Flag,
  layers: Layers,
  repeat: Repeat,
  grid: LayoutGrid,
  tag: Tag,
  mail: Mail,
  external: ExternalLink,
  building: Building2,
  filter: Funnel,
  "check-square": SquareCheckBig,
  smile: Smile,
  move: Move,
  smartphone: Smartphone,
  shield: Shield,
  file: FileText,
  loader: Loader,
  send: Send,
} satisfies Record<string, LucideIcon>;

export type Glyph = keyof typeof GLYPHS;

interface IconProps {
  glyph: Glyph;
  size?: number;
  className?: string;
}

/**
 * Decorative stroke icon (24px grid, inherits text color). Always pair it with visible text
 * or put it in a control that has an aria-label – it is never announced on its own.
 */
export function Icon({ glyph, size = 20, className }: IconProps) {
  const Cmp = GLYPHS[glyph] ?? Info;
  return (
    <Cmp
      width={size}
      height={size}
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ display: "block", flex: "none" }}
    />
  );
}

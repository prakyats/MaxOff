import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

/**
 * The three appearances, in the order every chooser lists them (the laptop menu, the phone sheet),
 * with the same labels, the same line under System and the same tick on the chosen one (owner, 12
 * Nov 2026: the two choosers read the same; v7.0).
 */
export const THEME_OPTIONS = [
  { value: "light", label: "Light", hint: null, Icon: SunIcon },
  { value: "dark", label: "Dark", hint: null, Icon: MoonIcon },
  {
    value: "system",
    label: "System",
    hint: "Follows this device\u2019s setting",
    Icon: MonitorIcon,
  },
] as const;

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

/** The three appearances, in the order every chooser lists them (the laptop menu, the phone sheet). */
export const THEME_OPTIONS = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
] as const;

import { useColorScheme } from "react-native";

const light = {
  background: "#F5F4EF",
  surface: "#FFFFFF",
  surfaceMuted: "#EFEDE6",
  border: "#E3E0D7",
  text: "#15171A",
  textMuted: "#6A6E75",
  accent: "#0E7C66",
  accentPressed: "#0B6654",
  accentSoft: "#DDF0EA",
  onAccent: "#FFFFFF",
  warning: "#A35A00",
  warningSoft: "#FBEBD3",
  danger: "#B4321F",
};

export type Palette = typeof light;

const dark: Palette = {
  background: "#0E1012",
  surface: "#171A1E",
  surfaceMuted: "#1F2328",
  border: "#2A2F35",
  text: "#F1F2F3",
  textMuted: "#9BA1A8",
  accent: "#3CC9A4",
  accentPressed: "#31AD8C",
  accentSoft: "#12352C",
  onAccent: "#06140F",
  warning: "#F2B35B",
  warningSoft: "#3A2A12",
  danger: "#F07A66",
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;
export const font = {
  title: 22,
  body: 16,
  small: 14,
  tiny: 12,
} as const;

export function useTheme(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

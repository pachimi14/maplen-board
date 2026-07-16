export const DEFAULT_SHARE_IMAGE_THEME = "fantasy";

export const SHARE_IMAGE_THEMES = {
  fantasy: {
    id: "fantasy",
    name: "Fantasy",
    frame: "/themes/fantasy/frame.webp",
    background: null,
    accentColor: "#F6B85A",
    particleColor: "#79E2CF",
    cardStyle: "asset-frame",
    safeArea: {
      top: 32,
      right: 32,
      bottom: 32,
      left: 32,
    },
    contentPadding: {
      x: 40,
      y: 32,
    },
  },
  aqua: {
    id: "aqua",
    name: "Aqua",
    frame: "/themes/aqua/frame.webp",
    background: null,
    accentColor: "#75D9F5",
    particleColor: "#79E2CF",
    cardStyle: "asset-frame",
    safeArea: {
      top: 32,
      right: 32,
      bottom: 32,
      left: 32,
    },
    contentPadding: {
      x: 40,
      y: 32,
    },
  },
  forest: {
    id: "forest",
    name: "Forest",
    frame: "/themes/forest/frame.webp",
    background: null,
    accentColor: "#79E2CF",
    particleColor: "#F6B85A",
    cardStyle: "asset-frame",
    safeArea: {
      top: 32,
      right: 32,
      bottom: 32,
      left: 32,
    },
    contentPadding: {
      x: 40,
      y: 32,
    },
  },
};

export function getShareImageTheme(themeName = DEFAULT_SHARE_IMAGE_THEME) {
  return SHARE_IMAGE_THEMES[themeName] || SHARE_IMAGE_THEMES[DEFAULT_SHARE_IMAGE_THEME];
}

export function listShareImageThemes() {
  return Object.values(SHARE_IMAGE_THEMES);
}

export const ShareImageThemeManager = {
  defaultThemeName: DEFAULT_SHARE_IMAGE_THEME,
  themes: SHARE_IMAGE_THEMES,
  getTheme: getShareImageTheme,
  setTheme: getShareImageTheme,
  listThemes: listShareImageThemes,
};

export type AliLhasaReturnWeatherKind = "forecast" | "trend";

export interface AliLhasaReturnWeatherDay {
  summary: string;
  range: string;
  note?: string;
  kind: AliLhasaReturnWeatherKind;
}

/** 2026-09-20 取值。中国天气网县级预报当时只出到 09.26；行程日用 Open-Meteo ECMWF。 */
export const aliLhasaReturnWeatherReviewedAt = "2026-09-20";
export const aliLhasaReturnWeatherCutoff = "2026-10-05";
export const aliLhasaReturnWeatherSource = "Open-Meteo ECMWF";

export const aliLhasaReturnWeatherByDate: Record<string, AliLhasaReturnWeatherDay> = {
  "09.26": {
    summary: "阴转小雨",
    range: "9~16°C",
    note: "拉萨市区",
    kind: "forecast",
  },
  "09.27": {
    summary: "阴",
    range: "8~18°C",
    note: "卡若拉更冷、阵风约45",
    kind: "forecast",
  },
  "09.28": {
    summary: "阴",
    range: "4~11°C",
    note: "白坝过夜",
    kind: "forecast",
  },
  "09.29": {
    summary: "阵雪",
    range: "-8~5°C",
    note: "巴松积雪、能见度差",
    kind: "forecast",
  },
  "09.30": {
    summary: "阴",
    range: "-4~7°C",
    note: "萨嘎县城",
    kind: "forecast",
  },
  "10.01": {
    summary: "多云",
    range: "-10~-2°C",
    note: "塔钦很冷",
    kind: "forecast",
  },
  "10.02": {
    summary: "阴到小雪",
    range: "-4~10°C",
    note: "狮泉河过夜",
    kind: "forecast",
  },
  "10.03": {
    summary: "晴间多云",
    range: "-8~8°C",
    note: "改则县城",
    kind: "forecast",
  },
  "10.04": {
    summary: "阴",
    range: "-4~6°C",
    note: "班戈风大",
    kind: "forecast",
  },
  "10.05": {
    summary: "纳木措阵雪",
    range: "0~13°C",
    note: "阵风约50 · 拉萨晚 5~19",
    kind: "forecast",
  },
  "10.06": {
    summary: "多云",
    range: "5~19°C",
    note: "拉萨趋势，出发前再核",
    kind: "trend",
  },
  "10.07": {
    summary: "阴有雨",
    range: "20~24°C",
    note: "上海趋势",
    kind: "trend",
  },
};

export function getAliLhasaReturnWeather(date: string): AliLhasaReturnWeatherDay | undefined {
  return aliLhasaReturnWeatherByDate[date];
}

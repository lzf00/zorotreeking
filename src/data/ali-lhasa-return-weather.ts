export type AliLhasaReturnWeatherKind = "forecast" | "trend";

export interface AliLhasaReturnWeatherDay {
  summary: string;
  dayHighC: number;
  nightLowC: number;
  range: string;
  note?: string;
  kind: AliLhasaReturnWeatherKind;
}

function day(summary: string, dayHighC: number, nightLowC: number, note: string, kind: AliLhasaReturnWeatherKind = "forecast"): AliLhasaReturnWeatherDay {
  return {
    summary,
    dayHighC,
    nightLowC,
    range: `白天${dayHighC}°C`,
    note: `夜${nightLowC}°C · ${note}`,
    kind,
  };
}

/**
 * 2026-09-21 取值。
 * 县城白天以中国天气网 09.26–09.27 为准；更远的日子用 Open-Meteo GFS 日最高。
 * 上一版用 ECMWF 日最低～日最高，把夜里的温度写成了白天。
 */
export const aliLhasaReturnWeatherReviewedAt = "2026-09-21";
export const aliLhasaReturnWeatherCutoff = "2026-10-06";
export const aliLhasaReturnWeatherSource = "中国天气网 + Open-Meteo GFS";

export const aliLhasaReturnWeatherByDate: Record<string, AliLhasaReturnWeatherDay> = {
  "09.26": day("阴", 20, 10, "拉萨市区"),
  "09.27": day("阴", 18, 4, "日喀则；卡若拉更冷"),
  "09.28": day("小雨", 13, 3, "定日白坝"),
  "09.29": day("阴", 8, -4, "巴松景区，比定日县城冷"),
  "09.30": day("阴", 10, 0, "萨嘎县城"),
  "10.01": day("多云", 6, 0, "塔钦；羽绒留给早出晚归"),
  "10.02": day("多云", 12, 2, "狮泉河"),
  "10.03": day("晴", 12, 4, "改则县城"),
  "10.04": day("多云", 14, 4, "班戈；湖区风大"),
  "10.05": day("多云", 13, 5, "纳木措白天；拉萨晚约20"),
  "10.06": day("晴", 21, 9, "拉萨还车日"),
  "10.07": day("阴", 22, 20, "上海趋势", "trend"),
};

export function getAliLhasaReturnWeather(date: string): AliLhasaReturnWeatherDay | undefined {
  return aliLhasaReturnWeatherByDate[date];
}

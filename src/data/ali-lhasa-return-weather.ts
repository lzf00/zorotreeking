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
 * 2026-09-24 取值。
 * 09.26–09.30 县城白天以中国天气网为准；巴松用景区格点校正。
 * 10.01 起用 Open-Meteo GFS 日最高。表内先写白天。
 */
export const aliLhasaReturnWeatherReviewedAt = "2026-09-24";
export const aliLhasaReturnWeatherCutoff = "2026-10-07";
export const aliLhasaReturnWeatherSource = "中国天气网 + Open-Meteo GFS";

export const aliLhasaReturnWeatherByDate: Record<string, AliLhasaReturnWeatherDay> = {
  "09.26": day("多云", 20, 7, "拉萨市区"),
  "09.27": day("多云", 18, 2, "日喀则；卡若拉更冷"),
  "09.28": day("多云", 15, 0, "定日白坝"),
  "09.29": day("阴", 8, -1, "巴松景区，比定日县城冷"),
  "09.30": day("晴", 14, -3, "萨嘎县城"),
  "10.01": day("晴", 3, -6, "塔钦；羽绒留给早出晚归"),
  "10.02": day("晴", 11, 1, "狮泉河"),
  "10.03": day("晴间多云", 13, 1, "改则县城"),
  "10.04": day("小雨", 10, 2, "班戈；湖区风大"),
  "10.05": day("小雨", 11, 1, "纳木措白天；拉萨晚约18"),
  "10.06": day("小雨", 18, 6, "拉萨还车日"),
  "10.07": day("小雨", 27, 22, "上海"),
};

export function getAliLhasaReturnWeather(date: string): AliLhasaReturnWeatherDay | undefined {
  return aliLhasaReturnWeatherByDate[date];
}

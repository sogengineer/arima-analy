import type { ExtractedRaceData, HorseData, RaceRecord } from '../types/HorseData';

/** JRA表記の戦績 `(1着.2着.3着.着外)` に戻す（`runs` は出走数なので着外を引く） */
export function formatRecord(record: RaceRecord): string {
  const unplaced = Math.max(0, record.runs - record.wins - record.places - record.shows);
  return `${record.wins}.${record.places}.${record.shows}.${unplaced}`;
}

/** 欠損を '-' で表示する */
function formatOptionalNumber(value: number | undefined): string {
  return value == null ? '-' : String(value);
}

function formatHeadline(horse: HorseData): string {
  const popularity = formatOptionalNumber(horse.raceInfo.popularity);
  const odds = formatOptionalNumber(horse.raceInfo.winOdds);
  return `${popularity}番人気: ${horse.basicInfo.name} (${odds}倍)`;
}

const PREVIOUS_RACE_LABELS = ['前走', '前々走', '3走前', '4走前'];

function formatHorseDetail(horse: HorseData): string {
  let output = `${formatHeadline(horse)}\n`;
  output += `  馬番: ${horse.raceInfo.horseNumber}番\n`;
  output += `  戦績: ${formatRecord(horse.record)}（${horse.record.runs}戦）\n`;
  output += `  総賞金: ${horse.record.prizeMoney || 'なし'}\n`;
  output += `  負担重量: ${horse.jockey.weight}kg\n`;
  output += `  騎手: ${horse.jockey.name || 'なし'}\n`;
  output += `  馬主: ${horse.basicInfo.ownerName || 'なし'}\n`;
  output += `  生産者: ${horse.basicInfo.breederName || 'なし'}\n`;
  output += `  調教師: ${horse.basicInfo.trainerName || 'なし'}\n`;
  output += `  血統: ${horse.bloodline.sire || 'なし'} × ${horse.bloodline.mare || 'なし'}\n`;

  if (horse.previousRaces.length > 0) {
    output += `  過去成績:\n`;
    for (let i = 0; i < horse.previousRaces.length; i++) {
      const race = horse.previousRaces[i];
      output += `    ${PREVIOUS_RACE_LABELS[i]}: ${race.date} ${race.raceName}\n`;
    }
  }

  return `${output}\n`;
}

function formatDetailed(data: ExtractedRaceData): string {
  let output = `\n=== JRA競走馬詳細データ ===\n`;
  output += `抽出件数: ${data.horseCount}頭\n`;
  output += `レース: ${data.raceInfo.raceName}\n`;
  output += `開催日: ${data.raceInfo.date}\n\n`;

  for (const horse of data.horses) {
    output += formatHorseDetail(horse);
  }

  return output;
}

function formatSummary(data: ExtractedRaceData): string {
  return data.horses.map(formatHeadline).join('\n');
}

function formatCSV(data: ExtractedRaceData): string {
  const headers = ['人気,馬名,馬番,オッズ,騎手,調教師,馬主,戦績'];
  const rows = data.horses.map(
    horse =>
      `${horse.raceInfo.popularity ?? ''},${horse.basicInfo.name},${horse.raceInfo.horseNumber},${horse.raceInfo.winOdds ?? ''},${horse.jockey.name},${horse.basicInfo.trainerName},${horse.basicInfo.ownerName},"${formatRecord(horse.record)}"`
  );

  return [headers, ...rows].join('\n');
}

/** 抽出結果を表示形式に整形する */
export function formatExtractedRaceData(
  data: ExtractedRaceData,
  format: 'detailed' | 'summary' | 'csv' = 'detailed'
): string {
  switch (format) {
    case 'summary':
      return formatSummary(data);
    case 'csv':
      return formatCSV(data);
    default:
      return formatDetailed(data);
  }
}

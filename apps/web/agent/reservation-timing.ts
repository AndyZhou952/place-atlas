export interface ExplicitReservationTiming {
  readonly advanceDays?: number;
  readonly bookingWindowLabel?: string;
}

/** Extract only an explicitly stated booking opening window, not a deadline. */
export function explicitReservationTiming(
  sourceText: string,
): ExplicitReservationTiming {
  const text = sourceText.normalize('NFKC');
  const bookingContext = (index: number, length: number) => {
    const before = text.slice(0, index);
    const start = Math.max(
      before.lastIndexOf('。'),
      before.lastIndexOf('.'),
      before.lastIndexOf('!'),
      before.lastIndexOf('?'),
    );
    const after = text.slice(index + length);
    const nextBoundary = after.search(/[。.!?]/u);
    const clause = text.slice(
      start + 1,
      nextBoundary < 0 ? undefined : index + length + nextBoundary,
    );
    return /予約|受付|book|reserv/iu.test(clause);
  };
  const day =
    /(?<!\d)(\d{1,3})\s*日前\s*(?:から|より)(?:\s*(?:予約|受付))?/u.exec(text);
  if (day && bookingContext(day.index, day[0].length)) {
    const advanceDays = Number(day[1]);
    if (advanceDays > 0 && advanceDays <= 365)
      return { advanceDays, bookingWindowLabel: day[0].trim() };
  }
  const month =
    /(?<!\d)(\d{1,2})\s*(?:か月|ヶ月|ケ月|ヵ月|カ月)\s*前\s*(?:から|より)(?:\s*(?:予約|受付))?/u.exec(
      text,
    );
  if (month && bookingContext(month.index, month[0].length))
    return { bookingWindowLabel: month[0].trim() };
  const english = /\b(\d{1,3})\s*days?\s+in\s+advance\b/iu.exec(text);
  if (english && bookingContext(english.index, english[0].length)) {
    const advanceDays = Number(english[1]);
    if (advanceDays > 0 && advanceDays <= 365)
      return { advanceDays, bookingWindowLabel: english[0].trim() };
  }
  const englishMonth =
    /\b(?:up to\s+)?(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+months?\s+in\s+advance\b/iu.exec(
      text,
    );
  if (
    englishMonth &&
    bookingContext(englishMonth.index, englishMonth[0].length)
  )
    return { bookingWindowLabel: englishMonth[0].trim() };
  return {};
}

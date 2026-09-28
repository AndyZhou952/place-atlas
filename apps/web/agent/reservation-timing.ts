export interface ExplicitReservationTiming {
  readonly advanceDays?: number;
  readonly bookingWindowLabel?: string;
  readonly releaseNote?: string;
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
  const japaneseRelease =
    /(?:毎月|各月)\s*\d{1,2}日(?:の)?\s*(?:午前|午後)?\s*\d{1,2}(?::[0-5]\d|時(?:[0-5]?\d分)?)\s*(?:から|より)\s*(?:(?:翌月|当月)分の)?(?:ご?予約)?受付(?:を)?開始/u.exec(
      text,
    );
  const englishRelease =
    /\b(?:Bookings|Reservations)\s+for\s+the\s+(?:following|next)\s+month\s+open\s+at\s+\d{1,2}:[0-5]\d\s+on\s+the\s+\d{1,2}(?:st|nd|rd|th)\s+of\s+each\s+month\b/iu.exec(
      text,
    );
  const releaseMatch = japaneseRelease ?? englishRelease;
  const releaseNote =
    releaseMatch && bookingContext(releaseMatch.index, releaseMatch[0].length)
      ? { releaseNote: releaseMatch[0].trim() }
      : {};
  const merchantMonth =
    /毎月\s*\d{1,2}日\s*に\s*翌月末日\s*までの\s*ご?予約を承ります/u.exec(text);
  if (merchantMonth) {
    const releaseClock =
      /(?:公式HP|オンライン|WEB)\s*[:：]\s*(毎月\s*\d{1,2}日(?:の)?\s*深夜\s*\d{1,2}時(?:[0-5]?\d分)?\s*より)/iu.exec(
        text,
      );
    const hasReleaseHeading =
      releaseClock &&
      /予約受付開始時間/u.test(
        text.slice(Math.max(0, releaseClock.index - 60), releaseClock.index),
      );
    return {
      bookingWindowLabel: merchantMonth[0].trim(),
      ...(hasReleaseHeading
        ? { releaseNote: releaseClock[1].trim() }
        : releaseNote),
    };
  }
  const day =
    /(?<!\d)(\d{1,3})\s*日前\s*(?:から|より)(?:\s*(?:予約|受付))?/u.exec(text);
  if (day && bookingContext(day.index, day[0].length)) {
    const advanceDays = Number(day[1]);
    if (advanceDays > 0 && advanceDays <= 365)
      return { advanceDays, bookingWindowLabel: day[0].trim(), ...releaseNote };
  }
  const month =
    /(?<!\d)(\d{1,2})\s*(?:か月|ヶ月|ケ月|ヵ月|カ月)\s*前\s*(?:から|より)(?:\s*(?:予約|受付))?/u.exec(
      text,
    );
  if (month && bookingContext(month.index, month[0].length))
    return { bookingWindowLabel: month[0].trim(), ...releaseNote };
  const english = /\b(\d{1,3})\s*days?\s+in\s+advance\b/iu.exec(text);
  if (english && bookingContext(english.index, english[0].length)) {
    const advanceDays = Number(english[1]);
    if (advanceDays > 0 && advanceDays <= 365)
      return {
        advanceDays,
        bookingWindowLabel: english[0].trim(),
        ...releaseNote,
      };
  }
  const englishMonth =
    /\b(?:up to\s+)?(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+months?\s+in\s+advance\b/iu.exec(
      text,
    );
  if (
    englishMonth &&
    bookingContext(englishMonth.index, englishMonth[0].length)
  )
    return { bookingWindowLabel: englishMonth[0].trim(), ...releaseNote };
  return releaseNote;
}

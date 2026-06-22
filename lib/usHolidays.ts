export type USHoliday = {
  id: string;
  title: string;
  date: string;
  type: "holiday";
  observed: boolean;
};

function toDateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function fixedDate(year: number, monthIndex: number, day: number) {
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

function nthWeekdayOfMonth(
  year: number,
  monthIndex: number,
  weekday: number,
  occurrence: number,
) {
  const date = fixedDate(year, monthIndex, 1);
  const offset = (weekday - date.getDay() + 7) % 7;
  date.setDate(1 + offset + (occurrence - 1) * 7);

  return date;
}

function lastWeekdayOfMonth(year: number, monthIndex: number, weekday: number) {
  const date = fixedDate(year, monthIndex + 1, 0);
  const offset = (date.getDay() - weekday + 7) % 7;
  date.setDate(date.getDate() - offset);

  return date;
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);

  return nextDate;
}

function getObservedDate(date: Date) {
  if (date.getDay() === 6) return addDays(date, -1);
  if (date.getDay() === 0) return addDays(date, 1);

  return date;
}

function getEasterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return fixedDate(year, month - 1, day);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildHoliday(title: string, date: Date, observed = false): USHoliday {
  const dateText = toDateOnly(date);
  const label = observed ? `${title} (Observed)` : title;

  return {
    id: `us-holiday-${dateText}-${slugify(label)}`,
    title: label,
    date: dateText,
    type: "holiday",
    observed,
  };
}

function addFederalFixedHoliday(
  holidays: USHoliday[],
  title: string,
  date: Date,
) {
  holidays.push(buildHoliday(title, date));

  const observedDate = getObservedDate(date);
  if (toDateOnly(observedDate) !== toDateOnly(date)) {
    holidays.push(buildHoliday(title, observedDate, true));
  }
}

export function getUSHolidays(year: number): USHoliday[] {
  const holidays: USHoliday[] = [];

  addFederalFixedHoliday(holidays, "New Year's Day", fixedDate(year, 0, 1));
  holidays.push(
    buildHoliday("Martin Luther King Jr. Day", nthWeekdayOfMonth(year, 0, 1, 3)),
  );
  holidays.push(
    buildHoliday(
      "Presidents' Day / Washington's Birthday",
      nthWeekdayOfMonth(year, 1, 1, 3),
    ),
  );
  holidays.push(
    buildHoliday("Easter Sunday", getEasterSunday(year)),
  );
  holidays.push(
    buildHoliday("Mother's Day", nthWeekdayOfMonth(year, 4, 0, 2)),
  );
  holidays.push(
    buildHoliday("Memorial Day", lastWeekdayOfMonth(year, 4, 1)),
  );
  addFederalFixedHoliday(holidays, "Juneteenth", fixedDate(year, 5, 19));
  holidays.push(
    buildHoliday("Father's Day", nthWeekdayOfMonth(year, 5, 0, 3)),
  );
  addFederalFixedHoliday(holidays, "Independence Day", fixedDate(year, 6, 4));
  holidays.push(
    buildHoliday("Labor Day", nthWeekdayOfMonth(year, 8, 1, 1)),
  );
  holidays.push(
    buildHoliday(
      "Columbus Day / Indigenous Peoples' Day",
      nthWeekdayOfMonth(year, 9, 1, 2),
    ),
  );
  holidays.push(buildHoliday("Halloween", fixedDate(year, 9, 31)));
  addFederalFixedHoliday(holidays, "Veterans Day", fixedDate(year, 10, 11));

  const thanksgiving = nthWeekdayOfMonth(year, 10, 4, 4);
  holidays.push(buildHoliday("Thanksgiving Day", thanksgiving));
  holidays.push(buildHoliday("Black Friday", addDays(thanksgiving, 1)));
  holidays.push(buildHoliday("Christmas Eve", fixedDate(year, 11, 24)));
  addFederalFixedHoliday(holidays, "Christmas Day", fixedDate(year, 11, 25));
  holidays.push(buildHoliday("New Year's Eve", fixedDate(year, 11, 31)));

  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

export function getUSHolidaysForYears(years: number[]) {
  const uniqueYears = Array.from(new Set(years.filter(Number.isFinite)));
  const holidaysById = new Map<string, USHoliday>();

  for (const year of uniqueYears) {
    for (const holiday of getUSHolidays(year)) {
      holidaysById.set(holiday.id, holiday);
    }
  }

  return Array.from(holidaysById.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

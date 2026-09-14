export function describeSchedule(expression: string) {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = expression.trim().split(/\s+/);
  if (dayOfMonth !== '*' || month !== '*' || !/^\d+$/.test(minute)) return 'Custom timing';

  const minuteNumber = Number(minute);
  if (hour === '*') return minuteNumber === 0 ? 'Every hour' : `Every hour at :${String(minuteNumber).padStart(2, '0')}`;
  if (!/^\d+$/.test(hour)) return 'Custom timing';

  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
    .format(new Date(2020, 0, 1, Number(hour), minuteNumber));
  if (dayOfWeek === '*') return `Daily at ${time}`;
  if (dayOfWeek === '1-5') return `Weekdays at ${time}`;

  const weekdays = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  if (/^[0-6]$/.test(dayOfWeek)) return `${weekdays[Number(dayOfWeek)]} at ${time}`;
  return 'Custom timing';
}

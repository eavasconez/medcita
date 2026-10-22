const prisma = require('../config/prisma');
const { sendReminder } = require('../services/notificationService');
const { SETTINGS_SELECT } = require('../services/reminderSettings');
const { clinicDateString, appointmentInstant } = require('../utils/clinicTime');

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

// Any appointment that is still going to happen is owed a reminder, whether
// or not the doctor has confirmed it yet.
const REMINDABLE_STATUSES = ['pending_approval', 'scheduled', 'confirmed'];

// How the day of an appointment is said, counted in the clinic's calendar from its "today"
const dayLabelFor = (date, today) => {
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / MS_PER_DAY);
  if (days === 0) return 'hoy';
  if (days === 1) return 'mañana';
  if (days === 2) return 'pasado mañana';
  return 'el';
};

// The 'YYYY-MM-DD' dates from `from` to `to`, both included
const datesBetween = (from, to) => {
  const dates = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += MS_PER_DAY) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
};

/**
 * Task to send appointment reminders.
 * Runs hourly and, for each clinic that has reminders on, picks up any pending/scheduled/confirmed
 * appointment that has crossed into the clinic's reminder window (24 h before by default; the clinic
 * can choose 2, 24 or 48 hours, and a second reminder closer to the appointment) and hasn't been
 * reminded yet (`reminderSentAt` / `secondReminderSentAt` is null), so each one is reminded once
 * per round, close to the chosen time, rather than all at once "the day before".
 * Covers every clinic, or only `clinicId` when one is given. Each clinic's appointment times (and
 * its "today") are read in its own timezone, and each clinic's channels and details are its own.
 */
const sendReminders = async ({ clinicId } = {}) => {
  console.log('Running reminder task...');

  const now = new Date();

  try {
    const clinics = await prisma.clinic.findMany({
      where: clinicId ? { id: clinicId } : {},
      select: SETTINGS_SELECT
    });

    for (const clinic of clinics) {
      await remindClinic(clinic, now);
    }

    console.log('Reminder task completed successfully');
  } catch (error) {
    console.error('Error in reminder task:', error);
    throw error;
  }
};

const remindClinic = async (clinic, now) => {
  // A clinic that turned them off, or left no channel to send them through, sends nothing
  if (!clinic.reminderEnabled || (!clinic.reminderWhatsapp && !clinic.reminderEmail)) return;

  await remindRound(clinic, now, { field: 'reminderSentAt', hours: clinic.reminderHours, kind: 'appointment_reminder' });
  // After the first round, so what it just sent is seen by the second one
  if (clinic.secondReminderHours) {
    await remindRound(clinic, now, { field: 'secondReminderSentAt', hours: clinic.secondReminderHours, kind: 'appointment_second_reminder', second: true });
  }
};

// One reminder of a clinic: the appointments that are within `hours` of starting and have not had
// this reminder yet. `field` is the column that says it was sent.
const remindRound = async (clinic, now, { field, hours, kind, second = false }) => {
  const { id: clinicId, timezone } = clinic;
  const todayStr = clinicDateString(now, timezone);
  const lastDateStr = clinicDateString(new Date(now.getTime() + hours * MS_PER_HOUR), timezone);

  // Appointments from today to the day the window reaches are the only ones that can fall inside
  // it, so this keeps the query narrow without needing a real datetime column.
  const appointments = await prisma.appointment.findMany({
    where: {
      clinicId,
      date: { in: datesBetween(todayStr, lastDateStr) },
      status: { in: REMINDABLE_STATUSES },
      [field]: null
    },
    include: {
      patient: true,
      doctor: true
    }
  });

  const due = appointments.filter((apt) => {
    const hoursUntil = (appointmentInstant(apt.date, apt.time, timezone) - now) / MS_PER_HOUR;
    return hoursUntil > 0 && hoursUntil <= hours;
  });

  console.log(`Found ${due.length} appointment(s) within ${hours}h (${kind})`);

  for (const apt of due) {
    const instant = appointmentInstant(apt.date, apt.time, timezone);

    // The second reminder is not owed when the first one already went out inside its window (an
    // appointment booked an hour ahead is not told twice in a row): it is dated as done and skipped.
    if (second && apt.reminderSentAt && (instant - apt.reminderSentAt) / MS_PER_HOUR <= hours) {
      await prisma.appointment.updateMany({ where: { id: apt.id, [field]: null }, data: { [field]: now } });
      continue;
    }

    // Atomically claim the appointment (only succeeds if it hasn't been
    // reminded yet) before sending anything, so an overlapping cron run
    // or a manual trigger can't both read the same row and send a
    // duplicate reminder.
    const claim = await prisma.appointment.updateMany({
      where: { id: apt.id, status: { in: REMINDABLE_STATUSES }, [field]: null },
      data: { [field]: new Date() }
    });
    if (claim.count === 0) {
      // Another invocation already claimed and is handling this one.
      continue;
    }

    // Send reminder via service (WhatsApp + Email, as the clinic chose)
    let delivered = false;
    try {
      delivered = await sendReminder({ ...apt, clinicId }, { dayLabel: dayLabelFor(apt.date, todayStr), clinic, kind });
    } catch (error) {
      console.error(`Reminder for appointment ${apt.id} failed:`, error.message);
    }

    if (delivered) {
      console.log(`Reminder sent to ${apt.patient.name}`);
    } else {
      // Nothing went out: release the claim so the next hourly run retries
      // instead of silently losing this reminder.
      await prisma.appointment.updateMany({
        where: { id: apt.id },
        data: { [field]: null }
      });
      console.error(`Reminder for appointment ${apt.id} was not delivered, will retry`);
    }
  }
};

module.exports = { sendReminders, dayLabelFor };

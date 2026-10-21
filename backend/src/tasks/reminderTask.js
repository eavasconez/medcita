const prisma = require('../config/prisma');
const { sendReminder } = require('../services/notificationService');
const { clinicDateString, appointmentInstant } = require('../utils/clinicTime');

const REMINDER_WINDOW_HOURS = 24;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

// Any appointment that is still going to happen is owed a reminder, whether
// or not the doctor has confirmed it yet.
const REMINDABLE_STATUSES = ['pending_approval', 'scheduled', 'confirmed'];

/**
 * Task to send appointment reminders ~24h before each appointment.
 * Runs hourly and picks up any pending/scheduled/confirmed appointment that
 * has crossed into the 24h window since the last run and hasn't been
 * reminded yet (`reminderSentAt` is null), so each one is reminded once,
 * close to 24h out, rather than all at once "the day before".
 */
const sendReminders = async () => {
  console.log('Running reminder task...');

  const now = new Date();
  const todayStr = clinicDateString(now);
  const tomorrowStr = clinicDateString(new Date(now.getTime() + 24 * MS_PER_HOUR));

  try {
    // Appointments happening today or tomorrow are the only ones that can
    // fall within the next 24h, so this keeps the query narrow without
    // needing a real datetime column.
    const appointments = await prisma.appointment.findMany({
      where: {
        date: { in: [todayStr, tomorrowStr] },
        status: { in: REMINDABLE_STATUSES },
        reminderSentAt: null
      },
      include: {
        patient: true,
        doctor: true
      }
    });

    const due = appointments.filter((apt) => {
      const hoursUntil = (appointmentInstant(apt.date, apt.time) - now) / MS_PER_HOUR;
      return hoursUntil > 0 && hoursUntil <= REMINDER_WINDOW_HOURS;
    });

    console.log(`Found ${due.length} appointment(s) within ${REMINDER_WINDOW_HOURS}h`);

    for (const apt of due) {
      // Atomically claim the appointment (only succeeds if it hasn't been
      // reminded yet) before sending anything, so an overlapping cron run
      // or a manual trigger can't both read the same row and send a
      // duplicate reminder.
      const claim = await prisma.appointment.updateMany({
        where: { id: apt.id, status: { in: REMINDABLE_STATUSES }, reminderSentAt: null },
        data: { reminderSentAt: new Date() }
      });
      if (claim.count === 0) {
        // Another invocation already claimed and is handling this one.
        continue;
      }

      // Send reminder via service (WhatsApp + Email)
      let delivered = false;
      try {
        delivered = await sendReminder(apt, {
          dayLabel: apt.date === todayStr ? 'hoy' : 'mañana'
        });
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
          data: { reminderSentAt: null }
        });
        console.error(`Reminder for appointment ${apt.id} was not delivered, will retry`);
      }
    }

    console.log('Reminder task completed successfully');
  } catch (error) {
    console.error('Error in reminder task:', error);
    throw error;
  }
};

module.exports = { sendReminders };

const prisma = require('../config/prisma');
const { sendReminder } = require('../services/notificationService');
const { addDays, format, startOfTomorrow, endOfTomorrow } = require('date-fns');

/**
 * Task to handle daily reminders for appointments
 * For demo, it checks for appointments scheduled for tomorrow
 */
const sendDailyReminders = async () => {
  console.log('Running daily reminders task...');
  
  // Find appointments for tomorrow
  const tomorrowStr = format(addDays(new Date(), 1), 'yyyy-MM-dd');
  
  try {
    const appointments = await prisma.appointment.findMany({
      where: {
        date: tomorrowStr,
        status: 'scheduled'
      },
      include: {
        patient: true,
        doctor: true
      }
    });

    console.log(`Found ${appointments.length} appointments for tomorrow (${tomorrowStr})`);

    for (const apt of appointments) {
      // Send reminder via service (WhatsApp + Email)
      await sendReminder(apt);
      
      // Update status to 'confirmed' if needed, or maintain scheduled
      await prisma.appointment.update({
        where: { id: apt.id },
        data: { status: 'confirmed' }
      });
      console.log(`Reminder sent to ${apt.patient.name}`);
    }

    console.log('Reminders task completed successfully');
  } catch (error) {
    console.error('Error in reminder task:', error);
  }
};

module.exports = { sendDailyReminders };

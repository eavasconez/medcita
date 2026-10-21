const prisma = require('../config/prisma');
const { maskPhone, maskEmail, scrubText } = require('../utils/mask');

// What happened to every message MedCita tried to send, so a failure is seen the
// day it starts instead of when a patient complains (the 20 Oct incident).
//
// `detail` is what a sender returns: { ok, provider, simulated?, messageId?,
// errorCode?, error? }. `context` says what the message was for:
// { kind, recipient, clinicId?, appointmentId? }.

const MAX_ERROR_LENGTH = 300;
// Consecutive failed messages of a channel that make the panel warn the admin
const FAILURE_ALERT_STREAK = 3;
const STATUS_WINDOW_DAYS = 7;
const STATUS_SAMPLE = 25;
const CHANNELS = ['whatsapp', 'email'];

const statusOf = (detail) => (!detail.ok ? 'failed' : detail.simulated ? 'simulated' : 'sent');

/**
 * Writes the row for one send. Never throws: failing to take a note must not turn
 * a delivered message into an error (or stop the next one), it is only logged.
 */
async function recordNotification({ channel, to, detail, context = {} }) {
  if (!context.kind) return null; // nothing to say what it was for: not part of the history
  try {
    return await prisma.notificationLog.create({
      data: {
        clinicId: context.clinicId ?? null,
        appointmentId: context.appointmentId ?? null,
        kind: context.kind,
        channel,
        provider: detail.provider,
        recipient: context.recipient || 'user',
        status: statusOf(detail),
        errorCode: detail.errorCode ? String(detail.errorCode).slice(0, 60) : null,
        error: detail.error ? scrubText(detail.error).slice(0, MAX_ERROR_LENGTH) : null,
        providerMessageId: detail.messageId ? String(detail.messageId).slice(0, 200) : null,
        destination: channel === 'email' ? maskEmail(to) : maskPhone(to)
      }
    });
  } catch (err) {
    console.error('Could not record the notification:', err.message);
    return null;
  }
}

const publicEntry = (row) => ({
  id: row.id,
  createdAt: row.createdAt,
  kind: row.kind,
  channel: row.channel,
  provider: row.provider,
  recipient: row.recipient,
  status: row.status,
  errorCode: row.errorCode,
  error: row.error,
  destination: row.destination
});

// The messages sent about one appointment, newest first
async function forAppointment(clinicId, appointmentId) {
  const rows = await prisma.notificationLog.findMany({
    where: { clinicId, appointmentId },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]
  });
  return rows.map(publicEntry);
}

/**
 * How each channel is doing for a clinic: the run of failed messages since the last
 * one that went out (looking at the last week), and whether that is enough to warn.
 * Simulated sends (no provider configured) are neither successes nor failures.
 */
async function channelStatus(clinicId) {
  const since = new Date(Date.now() - STATUS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const result = {};
  for (const channel of CHANNELS) {
    const rows = await prisma.notificationLog.findMany({
      where: { clinicId, channel, createdAt: { gte: since }, status: { in: ['sent', 'failed'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: STATUS_SAMPLE
    });
    let failedInARow = 0;
    while (failedInARow < rows.length && rows[failedInARow].status === 'failed') failedInARow++;
    const lastSent = rows.find((row) => row.status === 'sent');
    const lastFailure = rows.find((row) => row.status === 'failed');
    const simulatedRecently = failedInARow === 0 && rows.length === 0
      ? Boolean(await prisma.notificationLog.findFirst({ where: { clinicId, channel, createdAt: { gte: since }, status: 'simulated' }, select: { id: true } }))
      : false;
    result[channel] = {
      failing: failedInARow >= FAILURE_ALERT_STREAK,
      failedInARow,
      lastSentAt: lastSent?.createdAt ?? null,
      lastFailure: lastFailure
        ? { at: lastFailure.createdAt, kind: lastFailure.kind, provider: lastFailure.provider, errorCode: lastFailure.errorCode, error: lastFailure.error }
        : null,
      simulated: simulatedRecently
    };
  }
  return { alertAfter: FAILURE_ALERT_STREAK, windowDays: STATUS_WINDOW_DAYS, channels: result };
}

module.exports = { FAILURE_ALERT_STREAK, STATUS_WINDOW_DAYS, recordNotification, forAppointment, channelStatus };

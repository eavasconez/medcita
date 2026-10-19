const notificationService = require('../../src/services/notificationService');

// Replaces the real senders with recorders so nothing is ever sent and tests can
// assert on what would have gone out. `failPhones` makes WhatsApp fail for those
// numbers (the stub then resolves to false, like a provider error).
function stubNotifications() {
  const sent = [];
  const failPhones = new Set();

  const original = {
    sendWhatsApp: notificationService.sendWhatsApp,
    sendEmail: notificationService.sendEmail
  };

  notificationService.sendWhatsApp = async (to, message) => {
    if (failPhones.has(to)) return false;
    sent.push({ channel: 'whatsapp', to, message });
    return true;
  };
  notificationService.sendEmail = async (to, subject, text, html) => {
    sent.push({ channel: 'email', to, subject, text, html });
    return true;
  };

  return {
    sent,
    failPhones,
    clear: () => {
      sent.length = 0;
      failPhones.clear();
    },
    restore: () => Object.assign(notificationService, original)
  };
}

module.exports = { stubNotifications, notificationService };

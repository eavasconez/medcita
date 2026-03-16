const sendWhatsApp = async (to, message) => {
  console.log(`[WHATSAPP MOCK] To: ${to}, Message: ${message}`);
  
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      
      // Asegurar que el número empiece con + para formato internacional
      const formattedTo = to.startsWith('+') ? to : `+${to}`;
      
      await client.messages.create({
        body: message,
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: `whatsapp:${formattedTo}`
      });
      console.log(`[TWILIO] WhatsApp enviado exitosamente a ${formattedTo}`);
    } catch (error) {
      console.error('[TWILIO ERROR]:', error.message);
    }
  } else {
    console.log('Twilio credentials not found, skipping real SMS.');
  }
};

module.exports = { sendWhatsApp };

const sendWhatsApp = async (to, message) => {
  console.log(`[WHATSAPP MOCK] To: ${to}, Message: ${message}`);
  
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: message,
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: `whatsapp:${to}`
      });
      console.log('WhatsApp sent via Twilio');
    } catch (error) {
      console.error('Twilio Error:', error.message);
    }
  } else {
    console.log('Twilio credentials not found, skipping real SMS.');
  }
};

module.exports = { sendWhatsApp };

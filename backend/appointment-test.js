const axios = require('axios');
const { format } = require('date-fns');

const API_URL = 'http://localhost:5000/api';
const ADMIN_EMAIL = 'admin@medcita.ec';
const ADMIN_PASSWORD = 'admin1234';
const TARGET_DOCTOR_ID = '4e418350-2396-4641-a1c7-aa19d4f56bf6'; // Hugo Manosalvas

async function runAppointmentTest() {
  console.log('🚀 Starting Functional Appointment Test (Admin mode)...');
  
  try {
    // 1. Login to get token
    console.log(`🔑 Logging in as ${ADMIN_EMAIL}...`);
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    
    const token = loginRes.data.token;
    const authHeader = { headers: { Authorization: `Bearer ${token}` } };
    console.log('✅ Login successful.');

    // 2. Fetch available slots for Hugo
    const today = format(new Date(), 'yyyy-MM-dd');
    console.log(`📅 Fetching available slots for ${today} (Doctor: Hugo)...`);
    const slotsRes = await axios.get(`${API_URL}/availability/slots?date=${today}&doctorId=${TARGET_DOCTOR_ID}`, authHeader);
    
    // Check if slotsRes.data is an array (it might be empty if now > availability)
    const allSlots = Array.isArray(slotsRes.data) ? slotsRes.data : [];
    const availableSlots = allSlots.filter(s => s.status === 'available');
    console.log(`💡 Found ${availableSlots.length} available slots.`);

    if (availableSlots.length === 0) {
      console.log('⚠️ No slots to fill today for this doctor. Try tomorrow!');
      // Let's try to target tomorrow if today is empty
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = format(tomorrow, 'yyyy-MM-dd');
      
      console.log(`📅 Fetching available slots for tomorrow ${tomorrowStr}...`);
      const tomorrowSlotsRes = await axios.get(`${API_URL}/availability/slots?date=${tomorrowStr}&doctorId=${TARGET_DOCTOR_ID}`, authHeader);
      
      const tomorrowAvailable = tomorrowSlotsRes.data.filter(s => s.status === 'available');
      
      if (tomorrowAvailable.length > 0) {
          console.log(`💡 Found ${tomorrowAvailable.length} slots for tomorrow. Using those.`);
          await processSlots(tomorrowAvailable, tomorrowStr, authHeader);
      } else {
        console.log('❌ No slots found for tomorrow either.');
      }
      return;
    }

    await processSlots(availableSlots, today, authHeader);

  } catch (err) {
    console.error('❌ Test failed with error:', err.response?.data || err.message);
  }
}

async function processSlots(slots, date, authHeader) {
    console.log(`⚡ Booking ${slots.length} appointments via API for ${date}...`);
    
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const patientData = {
            patientName: `Functional Test ${i + 1}`,
            patientPhone: `+59395000100${i}`,
            patientEmail: `test${i}@medcita.ec`,
            patientCedula: `110000000${i}`,
            date: date,
            time: slot.time,
            doctorId: TARGET_DOCTOR_ID, // Important for Admin booking
            notes: 'Verified via Functional Test Script.'
        };

        try {
            process.stdout.write(`[\u23F3] API POST ${slot.time}: `);
            await axios.post(`${API_URL}/appointments`, patientData, authHeader);
            console.log('OK ✅');
        } catch (err) {
            console.log(`ERR ❌ (${err.response?.data?.error || err.message})`);
        }
    }
    console.log('\n✨ Functional Test Complete.');
}

runAppointmentTest();

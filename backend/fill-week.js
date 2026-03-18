const axios = require('axios');
const { format, addDays, startOfToday, endOfWeek, isBefore, isSameDay } = require('date-fns');

const API_URL = 'http://localhost:5000/api';
const ADMIN_EMAIL = 'admin@medcita.ec';
const ADMIN_PASSWORD = 'admin1234';
const TARGET_DOCTOR_ID = '4e418350-2396-4641-a1c7-aa19d4f56bf6'; // Hugo Manosalvas

async function fillWeek() {
  console.log('🚀 Starting Weekly Functional Test (4 appointments/day)...');
  
  try {
    // 1. Login
    console.log(`🔑 Logging in as ${ADMIN_EMAIL}...`);
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    
    const token = loginRes.data.token;
    const authHeader = { headers: { Authorization: `Bearer ${token}` } };
    console.log('✅ Login successful.');

    // 2. Iterate through the week
    const today = startOfToday();
    const lastDay = endOfWeek(today, { weekStartsOn: 1 }); // Until Sunday
    
    let currentDay = today;
    
    while (isBefore(currentDay, addDays(lastDay, 1))) {
      const dateStr = format(currentDay, 'yyyy-MM-dd');
      console.log(`\n📅 Processing ${dateStr}...`);
      
      // 3. Fetch slots for this day
      const slotsRes = await axios.get(`${API_URL}/availability/slots?date=${dateStr}&doctorId=${TARGET_DOCTOR_ID}`, authHeader);
      const availableSlots = Array.isArray(slotsRes.data) ? slotsRes.data.filter(s => s.status === 'available') : [];
      
      if (availableSlots.length === 0) {
        console.log(`  ⚠️ No available slots for ${dateStr}. Skipping.`);
      } else {
        // 4. Shuffle and pick 4 slots
        const shuffled = availableSlots.sort(() => 0.5 - Math.random());
        const selectedSlots = shuffled.slice(0, 4);
        
        console.log(`  💡 Found ${availableSlots.length} slots. Booking ${selectedSlots.length} random appointments...`);
        
        for (let i = 0; i < selectedSlots.length; i++) {
          const slot = selectedSlots[i];
          const statusOptions = ['confirmed', 'scheduled', 'pending_approval'];
          const randomStatus = statusOptions[Math.floor(Math.random() * statusOptions.length)];

          const patientData = {
            patientName: `Weekly Test ${format(currentDay, 'EEE')} #${i + 1}`,
            patientPhone: `+59398000${format(currentDay, 'dd')}${i}0`,
            patientEmail: `test.${dateStr}.${i}@medcita.ec`,
            patientCedula: `010${format(currentDay, 'dd')}000${i}`,
            date: dateStr,
            time: slot.time,
            doctorId: TARGET_DOCTOR_ID,
            status: randomStatus,
            notes: 'Weekly automated functional test.'
          };

          try {
            process.stdout.write(`    [\u23F3] API POST ${slot.time}: `);
            await axios.post(`${API_URL}/appointments`, patientData, authHeader);
            console.log('OK ✅');
          } catch (err) {
            console.log(`ERR ❌ (${err.response?.data?.error || err.message})`);
          }
          // Small delay to prevent rate issues
          await new Promise(r => setTimeout(r, 100));
        }
      }
      
      currentDay = addDays(currentDay, 1);
    }

    console.log('\n✨ Weekly Functional Test Complete. Check your dashboard for the new distribution.');

  } catch (err) {
    console.error('❌ Weekly test failed:', err.response?.data || err.message);
  }
}

fillWeek();

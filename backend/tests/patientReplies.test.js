const { samePhone, decide } = require('../src/services/patientReplies');

describe('samePhone', () => {
  it.each([
    ['593990000042', '+593990000042'],
    ['593990000042', '+593 99 000 0042'],
    ['593990000042', '0990000042'],
    ['593990000042', '990000042'],
    ['593990000042', '593-99-000-0042']
  ])('%s is %s', (a, b) => {
    expect(samePhone(a, b)).toBe(true);
    expect(samePhone(b, a)).toBe(true);
  });

  it.each([
    ['593990000042', '593990000043'],
    ['593990000042', '+57 3990000042'],
    ['593990000042', '0990000'], // too short to say anything
    ['593990000042', ''],
    ['593990000042', null],
    ['', ''],
    [undefined, undefined]
  ])('%s is not %s', (a, b) => {
    expect(samePhone(a, b)).toBe(false);
  });
});

describe('decide', () => {
  const now = new Date('2030-01-14T12:00:00Z'); // 07:00 in Ecuador
  const tomorrow = { status: 'pending_approval', date: '2030-01-15', time: '10:00' };
  const run = (action, appointment = tomorrow, timezone = 'America/Guayaquil') => decide({ action, appointment, timezone, now });

  it.each([
    ['confirm', 'pending_approval', { outcome: 'confirmed', nextStatus: 'confirmed' }],
    ['confirm', 'scheduled', { outcome: 'confirmed', nextStatus: 'confirmed' }],
    ['confirm', 'confirmed', { outcome: 'already_confirmed' }],
    ['cancel', 'pending_approval', { outcome: 'cancelled', nextStatus: 'cancelled' }],
    ['cancel', 'confirmed', { outcome: 'cancelled', nextStatus: 'cancelled' }],
    ['cancel', 'cancelled', { outcome: 'already_cancelled' }],
    ['confirm', 'cancelled', { outcome: 'not_applicable', reason: 'cancelled' }],
    ['reschedule', 'cancelled', { outcome: 'not_applicable', reason: 'cancelled' }],
    ['reschedule', 'confirmed', { outcome: 'reschedule_requested' }],
    ['confirm', 'completed', { outcome: 'not_applicable', reason: 'closed' }],
    ['cancel', 'no_show', { outcome: 'not_applicable', reason: 'closed' }],
    ['cancel', 'arrived', { outcome: 'not_applicable', reason: 'closed' }]
  ])('«%s» on a %s visit', (action, status, expected) => {
    expect(run(action, { ...tomorrow, status })).toEqual(expected);
  });

  it('counts a visit as past by the clinic\'s own clock', () => {
    // 10:00 on the 14th is 15:00 UTC in Ecuador (still ahead of 12:00 UTC), but 01:00 UTC in Tokyo (already gone)
    const sameDay = { status: 'confirmed', date: '2030-01-14', time: '10:00' };
    expect(run('cancel', sameDay, 'America/Guayaquil')).toEqual({ outcome: 'cancelled', nextStatus: 'cancelled' });
    expect(run('cancel', sameDay, 'Asia/Tokyo')).toEqual({ outcome: 'not_applicable', reason: 'past' });
  });

  it('counts a visit that starts right now as past', () => {
    expect(run('confirm', { status: 'pending_approval', date: '2030-01-14', time: '07:00' })).toEqual({ outcome: 'not_applicable', reason: 'past' });
  });
});

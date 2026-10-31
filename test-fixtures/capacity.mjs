export function capacityEvent({ long = false } = {}) {
  const skills = long ? Array.from({ length: 8 }, (_, i) => String.fromCharCode(97 + i).repeat(30)) : ['first-aid'];
  const volunteers = Array.from({ length: 80 }, (_, i) => ({
    id: long ? `v-${String(i).padStart(2, '0')}-${'x'.repeat(35)}` : `v-${i}`,
    name: long ? `${String(i).padStart(2, '0')} ${'বাংলা'.repeat(10)}` : `Volunteer ${i}`,
    skills: long || i % 10 === 0 ? skills : [],
    availability: long ? Array.from({ length: 20 }, (_, n) => [n * 72, (n + 1) * 72]) : [[0, 1440]],
    maxHours: 24,
    color: '#7864bb'
  }));
  const shifts = Array.from({ length: 24 }, (_, i) => ({ id: `s-${i}`, station: long ? `Station ${i} ${'A'.repeat(60)}` : `Station ${i}`, start: i * 60, end: (i + 1) * 60, required: 8, skills }));
  return { event: 'Capacity verification', date: '2026-10-31', timezone: 'Asia/Dhaka', volunteers, shifts, schedule: Object.fromEntries(shifts.map(s => [s.id, volunteers.slice(0, 8).map(p => p.id)])), history: [] };
}

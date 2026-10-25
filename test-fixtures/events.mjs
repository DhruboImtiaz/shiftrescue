export const demo = {
  date: '2026-10-18',
  event: 'Dhaka Campus Volunteer Day',
  timezone: 'Asia/Dhaka',
  volunteers: [
    { id: 'nadia', name: 'Nadia', skills: ['welcome', 'first-aid'], availability: [[600, 960]], maxHours: 4, color: '#7860bb' },
    { id: 'rahim', name: 'Rahim', skills: ['welcome'], availability: [[600, 960]], maxHours: 4, color: '#bd7446' },
    { id: 'sumi', name: 'Sumi', skills: ['welcome', 'first-aid'], availability: [[600, 960]], maxHours: 4, color: '#4d8b79' },
    { id: 'arif', name: 'Arif', skills: ['welcome'], availability: [[600, 960]], maxHours: 4, color: '#4f80ab' },
    { id: 'farhana', name: 'Farhana', skills: ['welcome', 'first-aid'], availability: [[600, 960]], maxHours: 4, color: '#ad647f' },
    { id: 'tanvir', name: 'Tanvir', skills: ['welcome'], availability: [[600, 960]], maxHours: 4, color: '#777d45' },
    { id: 'mehedi', name: 'Mehedi', skills: ['welcome', 'first-aid'], availability: [[600, 960]], maxHours: 2, color: '#558f9b' },
    { id: 'riya', name: 'Riya', skills: ['welcome'], availability: [[600, 960]], maxHours: 4, color: '#b18c3e' }
  ],
  shifts: [
    { id: 'reg-10', station: 'Welcome desk', start: 600, end: 720, required: 2, skills: ['welcome'] },
    { id: 'help-10', station: 'Support desk', start: 600, end: 720, required: 2, skills: ['first-aid'] },
    { id: 'reg-12', station: 'Welcome desk', start: 720, end: 840, required: 2, skills: ['welcome'] },
    { id: 'help-12', station: 'Support desk', start: 720, end: 840, required: 2, skills: ['first-aid'] },
    { id: 'reg-14', station: 'Welcome desk', start: 840, end: 960, required: 2, skills: ['welcome'] },
    { id: 'help-14', station: 'Support desk', start: 840, end: 960, required: 2, skills: ['first-aid'] }
  ],
  schedule: {
    'reg-10': ['nadia', 'rahim'], 'help-10': ['sumi', 'arif'],
    'reg-12': ['tanvir', 'riya'], 'help-12': ['farhana', 'mehedi'],
    'reg-14': ['arif', 'tanvir'], 'help-14': ['nadia', 'rahim']
  }
};

export const scenarios = {
  sick: { title: 'A last-minute sick call', text: 'Nadia cannot work from 14:00 to 16:00.', changes: [{ type: 'unavailable', volunteerId: 'nadia', start: '14:00', end: '16:00' }] },
  chain: { title: 'A change with a ripple effect', text: 'Nadia, Sumi and Farhana cannot work from 14:00 to 16:00. Mehedi can work a maximum of 2 hours.', changes: ['nadia', 'sumi', 'farhana'].map(volunteerId => ({ type: 'unavailable', volunteerId, start: '14:00', end: '16:00' })).concat({ type: 'max_hours', volunteerId: 'mehedi', hours: 2 }) },
  impossible: { title: 'When there is no valid cover', text: 'All first-aid volunteers are unavailable from 14:00 to 16:00.', changes: ['nadia', 'sumi', 'farhana', 'mehedi'].map(volunteerId => ({ type: 'unavailable', volunteerId, start: '14:00', end: '16:00' })) }
};

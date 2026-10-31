export const AVATAR_BUCKET = 'shiftrescue-avatars';

export function validateProfile(input) {
  const text = (key, max) => {
    if (typeof input[key] !== 'string' || input[key].trim().length > max) throw new Error(`Enter a valid ${key} (up to ${max} characters).`);
    return input[key].trim();
  };
  const name = text('name', 80), username = text('username', 30).toLowerCase();
  const phone = text('phone', 40).replace(/[\s().-]/g, '');
  const bio = input.bio === undefined ? '' : text('bio', 160);
  if (!name) throw new Error('Enter your name.');
  if (!/^[a-z0-9][a-z0-9._]{2,29}$/.test(username)) throw new Error('Use 3–30 letters, numbers, periods or underscores for your username, starting with a letter or number.');
  if (!/^\+?[0-9]{7,15}$/.test(phone)) throw new Error('Enter a phone number with 7–15 digits, including your country code if needed.');
  return { name, username, phone, bio };
}

export function serializeProfile(row, email) {
  return {
    name: row.name, username: row.username || '', phone: row.phone, bio: row.bio, email,
    avatarUrl: row.avatar_path ? `/api/profile/avatar?v=${encodeURIComponent(row.updated_at)}` : null
  };
}

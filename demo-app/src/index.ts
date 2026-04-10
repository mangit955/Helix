export function getUserName(user?: { profile?: { name?: string } }) {
  return user.profile.name.toUpperCase();
}

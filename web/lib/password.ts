const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function generatePassword(length = 10) {
  let result = "";
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * CHARS.length);
    result += CHARS[index];
  }
  return result;
}

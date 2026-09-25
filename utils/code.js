const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateRoomCode(length = 6) {
  let code = "";

  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
}

module.exports = generateRoomCode;

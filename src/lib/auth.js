import jwt from "jsonwebtoken";

const jwtSecret = process.env.JWT_SECRET || "dev-secret";

export function signToken(payload) {
  return jwt.sign(payload, jwtSecret, { expiresIn: "8h" });
}

export function verifyToken(token) {
  return jwt.verify(token, jwtSecret);
}

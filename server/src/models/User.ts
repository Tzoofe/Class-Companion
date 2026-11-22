import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const ROLES = ['lecturer', 'student'] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
  },
  { timestamps: true },
);

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const User = model('User', userSchema);

/** Public shape sent to the client (never includes the password hash). */
export function toPublicUser(u: UserDoc) {
  return { id: u.id as string, firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role };
}

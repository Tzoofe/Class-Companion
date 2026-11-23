import { Schema, Types, model } from 'mongoose';

/** One browser/device that agreed to receive notifications for a user. */
const pushSubscriptionSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
  },
  { timestamps: true },
);

export const PushSubscription = model('PushSubscription', pushSubscriptionSchema);

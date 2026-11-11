/**
 * Bootstrap the first administrator (there is no other way to create one).
 * Usage: npm run admin:grant -w @ahq/backend -- someone@example.com
 * The account must already exist and have a confirmed email.
 */
import mongoose from "mongoose";
import { EmailSchema } from "@ahq/api-contracts";
import { loadConfig } from "../config/env.js";
import { UserModel } from "../modules/users/user.model.js";
import { AuditLogModel } from "../modules/audit/audit-log.model.js";

async function main() {
  const email = EmailSchema.parse(process.argv[2] ?? "");
  const config = loadConfig();
  await mongoose.connect(config.MONGODB_URI);
  const user = await UserModel.findOne({ email });
  if (!user) throw new Error(`No account found for ${email}. Register in the app first.`);
  if (!user.emailVerifiedAt) throw new Error(`${email} has not confirmed their email yet.`);
  if (user.roles.includes("admin")) {
    console.log(`${email} is already an admin.`);
  } else {
    const before = [...user.roles];
    user.roles = Array.from(new Set([...user.roles, "admin" as const]));
    await user.save();
    await AuditLogModel.create({
      actorId: user._id,
      action: "user.roles.bootstrap_admin",
      targetType: "User",
      targetId: user.id,
      before: { roles: before },
      after: { roles: user.roles },
    });
    console.log(`Granted admin to ${email}.`);
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await mongoose.disconnect();
  process.exit(1);
});

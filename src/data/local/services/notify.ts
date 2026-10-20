/**
 * Simulated outbox. Nothing here sends anything: an SMS or email is written to
 * the notifications table as delivered, and the SMS wallet is debited, so the
 * Notifications page, the wallet card and the tenant's history all move as
 * they would in production — without a message ever leaving the browser.
 */
import { database, repos } from "../context";
import type { NotificationRow, TenantRow } from "../schema";
import { nowIso, round2 } from "../util";

export const SMS_UNIT_COST = 0.8;
export const SMS_LOW_THRESHOLD = 200;

export const TEMPLATES = [
  {
    key: "rent_reminder",
    label: "Rent reminder",
    description: "A friendly reminder before rent falls due.",
    channel: "both" as const,
    subject: "Rent reminder — {unit_label}",
    body: "Dear {first_name}, a reminder that rent of KES {amount} for {unit_label} is due on {due_date}. Pay via M-Pesa Paybill 000000, account {unit_label}. Thank you — Mawingu Properties.",
  },
  {
    key: "rent_overdue",
    label: "Rent overdue",
    description: "For a tenant with an outstanding balance.",
    channel: "both" as const,
    subject: "Outstanding balance — {unit_label}",
    body: "Dear {first_name}, our records show an outstanding balance of KES {balance} on {unit_label}. Kindly settle it at your earliest convenience or reply to discuss a plan. — Mawingu Properties.",
  },
  {
    key: "payment_received",
    label: "Payment received",
    description: "Confirms a payment was received.",
    channel: "sms" as const,
    subject: "Payment received",
    body: "Dear {first_name}, we have received your payment for {unit_label}. Thank you. Balance: KES {balance}. — Mawingu Properties.",
  },
  {
    key: "general_notice",
    label: "General notice",
    description: "Water interruptions, maintenance, meetings…",
    channel: "both" as const,
    subject: "Notice to residents of {building_name}",
    body: "Dear {first_name}, please note: ",
  },
  {
    key: "statement",
    label: "Monthly statement",
    description: "The monthly rent statement email.",
    channel: "email" as const,
    subject: "Your rent statement — {unit_label}",
    body: "Dear {first_name}, please find attached your rent statement for {unit_label}. Balance as at today: KES {balance}.",
  },
];

interface DeliverInput {
  tenant: TenantRow;
  channel: NotificationRow["channel"];
  subject: string;
  body: string;
  templateKey: string;
}

export function deliver({ tenant, channel, subject, body, templateKey }: DeliverInput): NotificationRow {
  const db = database();
  const needsPhone = channel !== "email";
  const needsEmail = channel !== "sms";
  let error = "";
  if (needsPhone && !tenant.phone) error = "No phone number on file.";
  else if (needsEmail && !tenant.email) error = "No email address on file.";
  const segments = Math.max(1, Math.ceil(body.length / 160));
  const cost = needsPhone ? round2(segments * SMS_UNIT_COST) : 0;
  if (!error && needsPhone && db.meta.sms_wallet < cost) error = "SMS wallet is empty (simulated).";
  if (!error && cost) {
    db.meta.sms_wallet = round2(db.meta.sms_wallet - cost);
    db.markDirty("meta");
  }
  const now = nowIso();
  return repos().notifications.insert({
    tenant: tenant.id,
    channel,
    subject,
    body,
    status: error ? "failed" : "sent",
    sent_at: error ? null : now,
    error,
    template_key: templateKey,
    created_at: now,
  });
}

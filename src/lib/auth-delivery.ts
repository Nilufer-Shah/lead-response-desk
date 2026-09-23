import nodemailer from "nodemailer";
import { env } from "./env";

export async function deliverAuthChallenge(input: { kind: "phone_otp" | "magic_link"; destination: string; secret: string; challengeId: string }) {
  const settings = env();
  const magicLink = `${settings.APP_URL}/login?challengeId=${encodeURIComponent(input.challengeId)}&token=${encodeURIComponent(input.secret)}`;
  if (settings.OTP_DELIVERY_MODE === "console") {
    process.stdout.write(input.kind === "magic_link" ? `Magic sign-in link: ${magicLink}\n` : `Phone OTP for ${input.destination}: ${input.secret}\n`);
    return;
  }
  if (input.kind === "magic_link") {
    if (!settings.SMTP_URL) throw new Error("SMTP_URL is required for email magic links");
    await nodemailer.createTransport(settings.SMTP_URL).sendMail({
      from: settings.EMAIL_FROM,
      to: input.destination,
      subject: "Your Roopkala Lead Desk sign-in link",
      text: `Open this secure sign-in link. It expires in 15 minutes: ${magicLink}`,
      html: `<p>Open this secure sign-in link. It expires in 15 minutes:</p><p><a href="${magicLink}">Sign in to Roopkala Lead Desk</a></p>`,
    });
    return;
  }
  if (!settings.SMS_WEBHOOK_URL) throw new Error("SMS_WEBHOOK_URL is required for phone OTP delivery");
  const response = await fetch(settings.SMS_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...(settings.SMS_WEBHOOK_TOKEN ? { authorization: `Bearer ${settings.SMS_WEBHOOK_TOKEN}` } : {}) },
    body: JSON.stringify({ to: input.destination, message: `Your Roopkala Lead Desk code is ${input.secret}. It expires in 15 minutes.` }),
  });
  if (!response.ok) throw new Error(`SMS provider rejected the request with ${response.status}`);
}

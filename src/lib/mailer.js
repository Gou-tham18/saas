import nodemailer from 'nodemailer';
import { config } from '../config/env.js';
import { logger } from './logger.js';

let transporter = null;

async function createSmtpTransporter() {
  logger.info({ host: config.SMTP_HOST }, 'Using configured SMTP server');

  let auth = undefined;
  if (config.SMTP_USER) {
    auth = { user: config.SMTP_USER, pass: config.SMTP_PASS };
  }

  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    auth: auth,
  });
}

async function createEtherealTransporter() {
  const account = await nodemailer.createTestAccount();
  logger.info({ user: account.user }, 'Using auto-generated Ethereal test inbox');

  return nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
  });
}

async function getTransporter() {
  if (transporter) {
    return transporter;
  }

  if (config.SMTP_HOST) {
    transporter = await createSmtpTransporter();
  } else {
    transporter = await createEtherealTransporter();
  }
  return transporter;
}

export async function sendMail(message) {
  const mailTransporter = await getTransporter();

  const info = await mailTransporter.sendMail({
    from: config.MAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: message.attachments,
  });

  let previewUrl = nodemailer.getTestMessageUrl(info);
  if (!previewUrl) {
    previewUrl = null;
  }

  logger.info(
    { to: message.to, subject: message.subject, messageId: info.messageId, previewUrl: previewUrl },
    'Email sent',
  );

  return { messageId: info.messageId, previewUrl: previewUrl };
}

const nodemailer = require('nodemailer');
const logger = require('./logger');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'mailhog',
  port: parseInt(process.env.SMTP_PORT || '1025'),
  secure: false,
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
});

const sendEmail = async ({ to, subject, html, text }) => {
  if (!to || !process.env.SMTP_HOST) {
    logger.debug('Email skipped: no recipient or SMTP not configured');
    return;
  }
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || '"CollabFlow" <noreply@collabflow.io>',
      to, subject, html, text,
    });
    logger.info(`Email sent to: ${to} | Subject: ${subject}`);
  } catch (err) {
    logger.error('Email send failed', { error: err.message, to });
  }
};

module.exports = { sendEmail };

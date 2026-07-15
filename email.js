const nodemailer = require('nodemailer');

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendOrderConfirmation(order) {
  if (!process.env.SMTP_USER) {
    console.log('[EMAIL] SMTP not configured — skipping confirmation email');
    return;
  }
  const transporter = createTransporter();
  const whatsappNum = process.env.WHATSAPP_NUMBER || '254700000000';

  await transporter.sendMail({
    from: `"EduAssist" <${process.env.SMTP_USER}>`,
    to: order.email,
    subject: `✅ We received your request — EduAssist`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f2ee;font-family:Calibri,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
        <!-- Header -->
        <tr><td style="background:#0F2040;padding:32px 40px;">
          <p style="margin:0;font-size:28px;font-weight:700;color:#ffffff;font-family:Georgia,serif;">EduAssist</p>
          <p style="margin:6px 0 0;font-size:13px;color:#C8993A;letter-spacing:2px;text-transform:uppercase;">Academic & Professional Support</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px 40px;">
          <p style="font-size:18px;font-weight:700;color:#0F2040;margin:0 0 12px;">Hi ${order.first_name}, we've got your request! 👋</p>
          <p style="color:#5A5248;font-size:14px;line-height:1.7;margin:0 0 24px;">
            Thank you for reaching out to EduAssist. We've received your request and will get back to you with a quote <strong>within a few hours</strong>.
          </p>

          <!-- Order summary box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;border-radius:8px;padding:20px;margin-bottom:24px;">
            <tr><td>
              <p style="font-size:11px;font-weight:700;color:#C8993A;letter-spacing:2px;text-transform:uppercase;margin:0 0 14px;">Your Request Summary</p>
              ${row('Order ID', order.id)}
              ${row('Service', order.service)}
              ${row('Level', order.level || '—')}
              ${row('Deadline', order.deadline || '—')}
              ${row('Budget', order.budget || '—')}
            </td></tr>
          </table>

          <p style="color:#5A5248;font-size:14px;line-height:1.7;margin:0 0 24px;">
            Want a faster response? Message us directly on WhatsApp — just mention your Order ID above.
          </p>

          <a href="https://wa.me/${whatsappNum}?text=Hi%2C%20I%20submitted%20order%20${order.id}%20on%20EduAssist"
             style="display:inline-block;background:#25D366;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:6px;font-size:14px;font-weight:600;">
            💬 Message us on WhatsApp
          </a>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f4f2ee;padding:20px 40px;border-top:1px solid #e8e4dc;">
          <p style="margin:0;font-size:12px;color:#a09888;text-align:center;">
            EduAssist · Academic & Professional Support Platform<br>
            <a href="mailto:${process.env.ADMIN_EMAIL}" style="color:#C8993A;">${process.env.ADMIN_EMAIL || 'hello@eduassist.com'}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
    `
  });
}

async function sendAdminNotification(order) {
  if (!process.env.SMTP_USER || !process.env.ADMIN_EMAIL) {
    console.log('[EMAIL] Admin email not configured — skipping admin notification');
    return;
  }
  const transporter = createTransporter();

  await transporter.sendMail({
    from: `"EduAssist Orders" <${process.env.SMTP_USER}>`,
    to: process.env.ADMIN_EMAIL,
    subject: `🔔 New Order: ${order.service} — ${order.first_name} ${order.last_name}`,
    html: `
<!DOCTYPE html>
<html>
<body style="font-family:Calibri,Arial,sans-serif;background:#f4f2ee;padding:30px;">
  <div style="background:#ffffff;border-radius:10px;max-width:560px;margin:auto;overflow:hidden;">
    <div style="background:#0F2040;padding:20px 30px;">
      <p style="color:#C8993A;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0 0 4px;">New Order Received</p>
      <p style="color:#ffffff;font-size:20px;font-weight:700;margin:0;font-family:Georgia,serif;">${order.service}</p>
    </div>
    <div style="padding:24px 30px;">
      <table width="100%" cellpadding="6">
        <tr><td style="color:#a09888;font-size:13px;width:130px;">Order ID</td><td style="font-size:13px;color:#2C2820;font-weight:600;">${order.id}</td></tr>
        <tr><td style="color:#a09888;font-size:13px;">Name</td><td style="font-size:13px;color:#2C2820;">${order.first_name} ${order.last_name}</td></tr>
        <tr><td style="color:#a09888;font-size:13px;">Email</td><td style="font-size:13px;"><a href="mailto:${order.email}" style="color:#0F2040;">${order.email}</a></td></tr>
        <tr><td style="color:#a09888;font-size:13px;">WhatsApp</td><td style="font-size:13px;color:#2C2820;">${order.whatsapp || '—'}</td></tr>
        <tr><td style="color:#a09888;font-size:13px;">Level</td><td style="font-size:13px;color:#2C2820;">${order.level || '—'}</td></tr>
        <tr><td style="color:#a09888;font-size:13px;">Deadline</td><td style="font-size:13px;color:#2C2820;">${order.deadline || '—'}</td></tr>
        <tr><td style="color:#a09888;font-size:13px;">Budget</td><td style="font-size:13px;color:#2C2820;">${order.budget || '—'}</td></tr>
      </table>
      ${order.details ? `
      <div style="background:#f4f2ee;border-radius:6px;padding:14px;margin-top:16px;">
        <p style="font-size:11px;color:#a09888;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Details</p>
        <p style="font-size:13px;color:#2C2820;margin:0;line-height:1.6;">${order.details}</p>
      </div>` : ''}
      ${order.whatsapp ? `
      <div style="margin-top:20px;">
        <a href="https://wa.me/${order.whatsapp.replace(/\D/g,'')}" style="background:#25D366;color:white;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;display:inline-block;margin-right:10px;">Reply on WhatsApp</a>
        <a href="mailto:${order.email}" style="border:1px solid #0F2040;color:#0F2040;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;display:inline-block;">Reply by Email</a>
      </div>` : ''}
    </div>
  </div>
</body>
</html>
    `
  });
}

async function sendQuoteEmail(order, price, message) {
  if (!process.env.SMTP_USER) return;
  const transporter = createTransporter();

  await transporter.sendMail({
    from: `"EduAssist" <${process.env.SMTP_USER}>`,
    to: order.email,
    subject: `💰 Your quote is ready — EduAssist`,
    html: `
<!DOCTYPE html>
<html>
<body style="font-family:Calibri,Arial,sans-serif;background:#f4f2ee;padding:30px;">
  <div style="background:#fff;border-radius:10px;max-width:560px;margin:auto;overflow:hidden;">
    <div style="background:#0F2040;padding:20px 30px;">
      <p style="color:#ffffff;font-size:22px;font-weight:700;margin:0;font-family:Georgia,serif;">EduAssist</p>
    </div>
    <div style="padding:28px 30px;">
      <p style="font-size:17px;font-weight:700;color:#0F2040;margin:0 0 10px;">Hi ${order.first_name}, your quote is ready!</p>
      <p style="color:#5A5248;font-size:14px;line-height:1.7;margin:0 0 20px;">We've reviewed your request (Order <strong>${order.id}</strong>) and here is our quote:</p>
      <div style="background:#0F2040;border-radius:10px;padding:24px;text-align:center;margin-bottom:20px;">
        <p style="color:#C8993A;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Your Quote</p>
        <p style="color:#ffffff;font-size:38px;font-weight:700;margin:0;font-family:Georgia,serif;">${price}</p>
        <p style="color:#aaaacc;font-size:12px;margin:6px 0 0;">For: ${order.service}</p>
      </div>
      ${message ? `<p style="color:#5A5248;font-size:14px;line-height:1.7;margin:0 0 20px;">${message}</p>` : ''}
      <p style="color:#5A5248;font-size:14px;line-height:1.7;margin:0 0 20px;">Reply to this email or message us on WhatsApp to confirm and proceed.</p>
      <a href="https://wa.me/${process.env.WHATSAPP_NUMBER || '254700000000'}?text=I%20accept%20the%20quote%20for%20order%20${order.id}"
         style="display:inline-block;background:#25D366;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:6px;font-size:14px;font-weight:600;">
        ✅ Accept quote on WhatsApp
      </a>
    </div>
  </div>
</body>
</html>
    `
  });
}

function row(label, value) {
  return `<tr>
    <td style="font-size:12px;color:#a09888;padding:5px 0;width:110px;">${label}</td>
    <td style="font-size:13px;color:#2C2820;font-weight:500;padding:5px 0;">${value}</td>
  </tr>`;
}

module.exports = { sendOrderConfirmation, sendAdminNotification, sendQuoteEmail };

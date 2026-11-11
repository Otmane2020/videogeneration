// E-mails transactionnels (Resend). Un gabarit commun aux couleurs de la marque, un modèle par message.
// L'envoi n'est jamais bloquant : une erreur est journalisée, l'action de l'utilisateur aboutit quand même.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function layout({ preview, title, lines, button, url, note, origin = 'https://www.clipmotion.ai' }) {
  const p = lines.map((l) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3b3852">${l}</p>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f1fb;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1fb;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:#14102e;padding:22px 32px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:12px"><img src="${esc(origin)}/logo.png" width="40" height="40" alt="ClipMotion" style="display:block;border:0;border-radius:11px"></td><td style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-.02em">ClipMotion</td></tr></table></td></tr>
<tr><td style="height:4px;line-height:4px;font-size:0;background:#c44dff;background:linear-gradient(100deg,#6a5cff,#c44dff 52%,#ff6b8b)">&nbsp;</td></tr>
<tr><td style="padding:32px 32px 12px">
<h1 style="margin:0 0 18px;font-size:24px;line-height:1.25;color:#14102e">${esc(title)}</h1>
${p}
${button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr><td style="border-radius:14px;background:#6a5cff"><a href="${esc(url)}" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none">${esc(button)}</a></td></tr></table>` : ''}
${note ? `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#7b7896">${note}</p>` : ''}
</td></tr>
<tr><td style="padding:18px 32px 28px;border-top:1px solid #ece9f8;font-size:12px;line-height:1.5;color:#9a97b3">ClipMotion · AI video ads for e-commerce and SaaS · <a href="https://clipmotion.ai" style="color:#6a5cff">clipmotion.ai</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = [title, '', ...lines.map((l) => l.replace(/<[^>]+>/g, '')), ...(button ? ['', `${button}: ${url}`] : []), ...(note ? ['', note.replace(/<[^>]+>/g, '')] : []), '', 'ClipMotion · clipmotion.ai'].join('\n');
  return { html, text };
}

const TEMPLATES = {
  note: ({ origin, title, lines }) => ({
    subject: `ClipMotion · ${title}`, preview: lines[0] || title, title, lines: lines.map(esc),
    button: 'Open the admin', url: origin + '/admin',
  }),
  daily: ({ origin, day, rows, top }) => ({
    subject: `ClipMotion daily report · ${day}`, preview: rows.map((r) => `${r[0]}: ${r[1]}`).join(' · '), title: `Daily report · ${day}`,
    lines: [
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + rows.map((r) => `<tr><td style="padding:8px 0;border-bottom:1px solid #ece9f8;color:#3b3852">${esc(r[0])}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #ece9f8;font-weight:700;color:#14102e">${esc(r[1])}</td></tr>`).join('') + '</table>',
      top.length ? '<strong>Top pages</strong><br>' + top.map((t) => `${esc(t.path)} — ${esc(t.n)}`).join('<br>') : 'No page views recorded.',
    ],
    button: 'Open the admin', url: origin + '/admin',
  }),
  welcome: ({ origin }) => ({
    subject: 'Welcome to ClipMotion',
    preview: 'Your account is ready. Paste a link and get your first video ad.',
    title: 'Welcome to ClipMotion',
    lines: ['Your account is ready.', 'Paste a product page or your website, choose what the video is for, and your first ad is edited in a few minutes. You can then rewrite any line, swap a visual and change the music.'],
    button: 'Create my first video', url: origin + '/#top',
  }),
  reset: ({ origin, token }) => ({
    subject: 'Reset your ClipMotion password',
    preview: 'Use this link to choose a new password. It expires in one hour.',
    title: 'Reset your password',
    lines: ['We received a request to reset the password of your ClipMotion account.', 'This link is valid for one hour and can be used once.'],
    button: 'Choose a new password', url: `${origin}/?reset=${encodeURIComponent(token)}`,
    note: 'If you did not ask for this, you can ignore this email: your password stays the same.',
  }),
  planActive: ({ origin, plan }) => ({
    subject: `Your ClipMotion ${plan} plan is active`,
    preview: 'Thank you. Your plan is now active on your account.',
    title: `Your ${plan} plan is active`,
    lines: ['Thank you for your payment.', `The <strong>${esc(plan)}</strong> plan is now active on your account, including custom AI-generated scenes.`],
    button: 'Open ClipMotion', url: origin + '/',
    note: 'Your receipt is sent separately by our payment provider.',
  }),
  planEnded: ({ origin }) => ({
    subject: 'Your ClipMotion plan has ended',
    preview: 'Your account is back on the Starter plan.',
    title: 'Your plan has ended',
    lines: ['Your subscription has ended and your account is back on the free Starter plan.', 'You can keep creating video ads, and upgrade again whenever you like.'],
    button: 'See plans', url: origin + '/#pricing',
  }),
};

const admins = () => String(process.env.ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
// Alerte courte envoyée aux administrateurs (inscription, achat, e-mail reçu).
const notifyAdmins = (title, lines) => Promise.all(admins().map((to) => sendMail(to, 'note', { title, lines })));

async function sendMail(to, template, data = {}) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !TEMPLATES[template]) return false;
  const origin = process.env.PUBLIC_URL || 'https://www.clipmotion.ai';
  // le logo vient toujours du site public, même si le lien d'action pointe ailleurs
  const t = { ...TEMPLATES[template]({ origin, ...data }), origin };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || 'ClipMotion <hello@clipmotion.ai>', to: [to], subject: t.subject, ...layout(t) }),
    });
    if (!r.ok) console.error('mail', template, r.status, (await r.text()).slice(0, 200));
    return r.ok;
  } catch (e) { console.error('mail', template, e.message); return false; }
}

module.exports = { sendMail, TEMPLATES, layout, admins, notifyAdmins };

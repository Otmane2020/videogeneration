// Balise de mesure d'audience ClipMotion (sans cookie) : page, provenance et paramètres de campagne (UTM, identifiants de clic publicitaire).
try {
  var q = new URLSearchParams(location.search), g = function (k) { return q.get(k) || ''; };
  var body = JSON.stringify({
    path: location.pathname, ref: document.referrer,
    utm: { source: g('utm_source') || g('ref'), medium: g('utm_medium'), campaign: g('utm_campaign'), click: g('gclid') || g('fbclid') || g('msclkid') || g('ttclid') || g('li_fat_id') },
  });
  if (navigator.sendBeacon) navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
  else fetch('/api/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true });
} catch (e) {}
